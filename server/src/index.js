import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadAdminKey } from "./auth.js";
import { loadDotEnv } from "./env.js";

loadDotEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3000;
// Every interface, so phones on the same network can reach it.
const HOST = "0.0.0.0";
// A "data" folder beside the server: <repo>/data normally, /data in the Docker image.
const DATA_DIR = path.join(ROOT, "..", "data");

const { app } = createApp({
  dataDir: DATA_DIR,
  distDir: path.join(ROOT, "dist"),
  adminKey: loadAdminKey(),
});

app.listen(PORT, HOST, () => {
  console.log(`Inventory API listening on http://${HOST}:${PORT}`);
  console.log(`SQLite: ${path.join(DATA_DIR, "inventory.sqlite")}`);
  if (!loadAdminKey()) {
    console.warn("ADMIN_KEY is not set: no device can be paired until it is added to .env.");
  }
});
