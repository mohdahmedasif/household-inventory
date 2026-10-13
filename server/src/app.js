import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createAuth } from "./auth.js";
import { config } from "./config.js";
import { createDb, getSettings } from "./db.js";
import { createStores } from "./stores.js";

/**
 * The whole server as an Express app, without listening. `now` is the clock,
 * so tests can move time forward.
 */
export function createApp({ dataDir, distDir, adminKey, now = Date.now }) {
  // The main database holds access (devices, profiles, sessions); each profile's
  // inventory lives in its own file.
  const db = createDb(path.join(dataDir, "inventory.sqlite"));
  const stores = createStores(db, dataDir);
  stores.claimLegacy();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const auth = createAuth(db, {
    adminKey,
    now,
    onProfileDeleted: (profileId) => stores.remove(profileId),
    // Shown on the pairing screen, before anything else is known about the visitor.
    brand: () => {
      const { app_name, app_tagline } = getSettings(db);
      return { app_name, app_tagline, pin_min: config.pinMinDigits, pin_max: config.pinMaxDigits };
    },
  });

  // Access is decided by which router a request falls into, in this order.
  // Anything the public router does not match needs a paired device, and
  // anything the device router does not match needs an unlocked profile too.
  // A path that matches nothing (including an encoded variant of a real one)
  // therefore stops at the first guard it has not passed.
  app.use("/api", auth.publicRouter);
  app.use("/api", auth.requireDevice, auth.deviceRouter);
  app.use("/api", auth.requireSession, auth.profileRouter, (req, res, next) => {
    // Data requests go to the unlocked profile's own database, and nowhere else.
    stores.storeFor(req.session.profile_id).router(req, res, next);
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  if (distDir && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.use((err, _req, res, _next) => {
    const status = Number(err.status || err.statusCode || 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || "Unexpected error" });
  });

  return { app, db, stores };
}
