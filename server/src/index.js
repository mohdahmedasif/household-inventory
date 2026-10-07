import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createDb } from "./db.js";
import { loadDotEnv } from "./env.js";
import { createRouter } from "./routes.js";

loadDotEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.INVENTORY_API_PORT || process.env.PORT || 3000);
const HOST = process.env.INVENTORY_API_HOST || "0.0.0.0";
const DATA_DIR = process.env.INVENTORY_DATA_DIR || path.join(ROOT, "..", "data");
const DIST_DIR = process.env.INVENTORY_DIST_DIR || path.join(ROOT, "dist");
const API_KEY = (process.env.INVENTORY_API_KEY || "").trim();

const db = createDb(path.join(DATA_DIR, "inventory.sqlite"));
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth", (_req, res) => {
  res.json({ required: Boolean(API_KEY) });
});

app.use("/api", (req, res, next) => {
  if (!API_KEY) return next();
  const header = String(req.headers.authorization || "");
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = String(req.headers["x-api-key"] || "").trim();
  if (bearer === API_KEY || alt === API_KEY) return next();
  res.status(401).json({ error: "Unauthorized" });
});

app.use("/api", createRouter(db));

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  const status = Number(err.status || err.statusCode || 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Unexpected error" });
});

app.listen(PORT, HOST, () => {
  console.log(`Inventory API listening on http://${HOST}:${PORT}`);
  console.log(`SQLite: ${path.join(DATA_DIR, "inventory.sqlite")}`);
  if (!API_KEY) {
    console.warn("INVENTORY_API_KEY is not set — the API is open on this host.");
  }
});
