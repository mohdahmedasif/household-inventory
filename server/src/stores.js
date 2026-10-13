import fs from "node:fs";
import path from "node:path";
import { createDb, getMeta, setMeta } from "./db.js";
import { createRouter } from "./routes.js";

// Every profile has its own database file (inventory, history, catalog,
// settings, Gemini keys), so one profile's requests cannot reach another's
// data by construction. The main database only keeps who may get in.

const ACCESS_TABLES = ["sessions", "devices", "profiles"];
const LEGACY_OWNER = "legacy_owner";

export function createStores(mainDb, dataDir) {
  const open = new Map();
  const fileFor = (profileId) => path.join(dataDir, `profile-${profileId}.sqlite`);

  // The inventory from before profiles were separate is handed, once, to the
  // oldest profile. Everyone else starts empty.
  function claimLegacy() {
    if (getMeta(mainDb, LEGACY_OWNER)) return;
    const oldest = mainDb
      .prepare("SELECT profile_id FROM profiles ORDER BY profile_id ASC LIMIT 1")
      .get();
    if (!oldest) return;
    const file = fileFor(oldest.profile_id);
    if (!fs.existsSync(file)) {
      mainDb.prepare("VACUUM INTO ?").run(file);
      const copy = createDb(file);
      for (const table of ACCESS_TABLES) copy.exec(`DELETE FROM ${table}`);
      copy.close();
    }
    setMeta(mainDb, LEGACY_OWNER, String(oldest.profile_id));
  }

  function storeFor(profileId) {
    claimLegacy();
    let store = open.get(profileId);
    if (!store) {
      const db = createDb(fileFor(profileId));
      store = { db, router: createRouter(db) };
      open.set(profileId, store);
    }
    return store;
  }

  // A deleted profile's inventory is set aside under another name, not erased.
  function remove(profileId) {
    const store = open.get(profileId);
    if (store) {
      store.db.close();
      open.delete(profileId);
    }
    const file = fileFor(profileId);
    if (fs.existsSync(file)) {
      fs.renameSync(file, path.join(dataDir, `deleted-profile-${profileId}-${Date.now()}.sqlite`));
    }
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  }

  function closeAll() {
    for (const store of open.values()) store.db.close();
    open.clear();
  }

  return { storeFor, remove, claimLegacy, closeAll };
}
