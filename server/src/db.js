import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_SEEDS, SETTINGS_SCHEMA, coerceSetting, sentenceCase, titleCase } from "./catalog.js";
import { config } from "./config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  product_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  name_key TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  last_updated TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS companies (
  company_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  name_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS batches (
  batch_id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(company_id) ON DELETE SET NULL,
  location TEXT NOT NULL DEFAULT '',
  package_type TEXT NOT NULL DEFAULT '',
  package_count INTEGER NOT NULL DEFAULT 1,
  units_per_package TEXT NOT NULL DEFAULT '',
  size_value TEXT NOT NULL DEFAULT '',
  size_unit TEXT NOT NULL DEFAULT '',
  expiry_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  acquired_on TEXT NOT NULL DEFAULT '',
  last_updated TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_options (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, name)
);

-- One row per change in a batch's package count (purchase, use, correction).
-- batch_id is not a foreign key so history survives a deleted batch.
CREATE TABLE IF NOT EXISTS stock_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  batch_id INTEGER,
  kind TEXT NOT NULL,
  delta INTEGER NOT NULL,
  count_after INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_events_product_id ON stock_events(product_id);
CREATE INDEX IF NOT EXISTS idx_products_name_key_category
  ON products(name_key, category);
CREATE INDEX IF NOT EXISTS idx_batches_product_id ON batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_company_id ON batches(company_id);
CREATE INDEX IF NOT EXISTS idx_batches_location ON batches(location);
`;

export function createDb(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrateFromItems(db);
  ensureSeq(db, "product_id_seq", "products", "product_id");
  ensureSeq(db, "company_id_seq", "companies", "company_id");
  ensureSeq(db, "batch_id_seq", "batches", "batch_id");
  // Keep legacy id_seq aligned with batch ids for import compatibility.
  ensureSeq(db, "id_seq", "batches", "batch_id");
  seedCatalog(db);
  seedSettings(db);
  capitalizeNames(db);
  return db;
}

// Rows saved before names and notes were capitalized on write (name_key is unaffected).
function capitalizeNames(db) {
  const units = getSettings(db).lowercase_units;
  const title = (value) => titleCase(value, units);
  const targets = [
    ["products", "product_id", "name", title],
    ["companies", "company_id", "name", title],
    ["products", "product_id", "notes", sentenceCase],
    ["batches", "batch_id", "notes", sentenceCase],
  ];
  const fix = db.transaction(() => {
    for (const [table, idColumn, column, convert] of targets) {
      const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`);
      const rows = db.prepare(`SELECT ${idColumn} AS id, ${column} AS value FROM ${table}`).all();
      for (const row of rows) {
        const value = convert(row.value);
        if (value !== row.value) update.run(value, row.id);
      }
    }
  });
  fix();
}

// ---------- Full backup ----------

export const BACKUP_FORMAT = "household-inventory-backup";
export const BACKUP_VERSION = 1;

// Parents before children, so a restore can insert in this order.
const BACKUP_TABLES = ["companies", "products", "batches", "stock_events", "catalog_options", "meta"];

/** Every row of every table, as one JSON-serializable object. */
export function exportBackup(db) {
  const tables = {};
  const read = db.transaction(() => {
    for (const table of BACKUP_TABLES) {
      tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
    }
  });
  read();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    tables,
  };
}

function invalidBackup(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Replace everything in the database with the contents of a backup, keeping
 * ids exactly as they were. All or nothing: a bad file leaves the data untouched.
 */
export function restoreBackup(db, backup) {
  if (!backup || backup.format !== BACKUP_FORMAT) {
    throw invalidBackup("That file is not an inventory backup.");
  }
  if (!Number.isInteger(backup.version) || backup.version > BACKUP_VERSION) {
    throw invalidBackup("That backup was made by a newer version of the app.");
  }
  const tables = backup.tables;
  if (!tables || BACKUP_TABLES.some((table) => !Array.isArray(tables[table]))) {
    throw invalidBackup("That backup is incomplete.");
  }

  const counts = {};
  const restore = db.transaction(() => {
    for (const table of [...BACKUP_TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();
    for (const table of BACKUP_TABLES) {
      const known = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
      const statements = new Map();
      for (const row of tables[table]) {
        const columns = known.filter((column) => row[column] !== undefined);
        const signature = columns.join(",");
        if (!statements.has(signature)) {
          statements.set(
            signature,
            db.prepare(
              `INSERT INTO ${table} (${signature}) VALUES (${columns.map(() => "?").join(", ")})`,
            ),
          );
        }
        statements.get(signature).run(...columns.map((column) => row[column]));
      }
      counts[table] = tables[table].length;
    }
    // Settings added since the backup was made get their starting values.
    seedSettings(db);
  });
  restore();
  return counts;
}

function ensureSeq(db, key, table, column) {
  const seq = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  if (!seq) {
    const maxRow = db
      .prepare(`SELECT COALESCE(MAX(${column}), 0) AS n FROM ${table}`)
      .get();
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      key,
      String(maxRow?.n ?? 0),
    );
  }
}

function migrateFromItems(db) {
  const hasItems = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'")
    .get();
  if (!hasItems) return;

  const itemCount = db.prepare("SELECT COUNT(*) AS n FROM items").get()?.n ?? 0;
  const batchCount = db.prepare("SELECT COUNT(*) AS n FROM batches").get()?.n ?? 0;
  if (itemCount === 0 || batchCount > 0) {
    db.exec("DROP TABLE IF EXISTS items");
    return;
  }

  const items = db.prepare("SELECT * FROM items ORDER BY item_id ASC").all();
  const insertProduct = db.prepare(`
    INSERT INTO products (product_id, name, name_key, category, notes, last_updated)
    VALUES (@product_id, @name, @name_key, @category, @notes, @last_updated)
  `);
  const insertCompany = db.prepare(`
    INSERT INTO companies (company_id, name, name_key)
    VALUES (@company_id, @name, @name_key)
  `);
  const insertBatch = db.prepare(`
    INSERT INTO batches (
      batch_id, product_id, company_id, location, package_type, package_count,
      units_per_package, size_value, size_unit, expiry_date, notes, acquired_on, last_updated
    ) VALUES (
      @batch_id, @product_id, @company_id, @location, @package_type, @package_count,
      @units_per_package, @size_value, @size_unit, @expiry_date, @notes, @acquired_on, @last_updated
    )
  `);

  const migrate = db.transaction(() => {
    const productByKey = new Map();
    const companyByKey = new Map();
    let nextProductId = 1;
    let nextCompanyId = 1;

    for (const item of items) {
      const name = String(item.name ?? "").trim();
      const category = String(item.category ?? "").trim();
      const nameKey = normalizeKey(name);
      const productKey = `${nameKey}::${category.toLowerCase()}`;
      let productId = productByKey.get(productKey);
      if (!productId) {
        productId = nextProductId++;
        productByKey.set(productKey, productId);
        insertProduct.run({
          product_id: productId,
          name,
          name_key: nameKey,
          category,
          notes: String(item.notes ?? "").trim(),
          last_updated: String(item.last_updated ?? "").trim() || todayStamp(),
        });
      } else {
        const existing = db
          .prepare("SELECT notes FROM products WHERE product_id = ?")
          .get(productId);
        if (!existing?.notes && item.notes) {
          db.prepare("UPDATE products SET notes = ? WHERE product_id = ?").run(
            String(item.notes).trim(),
            productId,
          );
        }
      }

      let companyId = null;
      const brand = String(item.brand ?? "").trim();
      if (brand) {
        const companyKey = normalizeKey(brand);
        companyId = companyByKey.get(companyKey);
        if (!companyId) {
          companyId = nextCompanyId++;
          companyByKey.set(companyKey, companyId);
          insertCompany.run({
            company_id: companyId,
            name: brand,
            name_key: companyKey,
          });
        }
      }

      const stamp = String(item.last_updated ?? "").trim() || todayStamp();
      insertBatch.run({
        batch_id: item.item_id,
        product_id: productId,
        company_id: companyId,
        location: String(item.location ?? "").trim(),
        package_type: String(item.package_type ?? "").trim(),
        package_count: Number(item.package_count) || 0,
        units_per_package: String(item.units_per_package ?? "").trim(),
        size_value: String(item.size_value ?? "").trim(),
        size_unit: String(item.size_unit ?? "").trim(),
        expiry_date: String(item.expiry_date ?? "").trim(),
        notes: String(item.notes ?? "").trim(),
        acquired_on: stamp,
        last_updated: stamp,
      });
    }

    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('product_id_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(nextProductId - 1));
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('company_id_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(nextCompanyId - 1));
    const maxBatch = db.prepare("SELECT COALESCE(MAX(batch_id), 0) AS n FROM batches").get();
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('batch_id_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(maxBatch?.n ?? 0));
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('id_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(maxBatch?.n ?? 0));
  });

  migrate();
  db.exec("DROP TABLE IF EXISTS items");
}

function seedCatalog(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM catalog_options").get();
  if ((count?.n ?? 0) > 0) return;
  const insert = db.prepare(
    "INSERT INTO catalog_options (kind, name, sort_order) VALUES (?, ?, ?)",
  );
  const seed = db.transaction(() => {
    for (const [kind, names] of Object.entries(DEFAULT_SEEDS)) {
      names.forEach((name, index) => insert.run(kind, name, index));
    }
  });
  seed();
}

function seedSettings(db) {
  const upsert = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  );
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
    upsert.run(key, serializeSetting(spec.initial));
  }
}

export function getMeta(db, key, fallback = "") {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? String(row.value) : fallback;
}

export function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}

export function listCatalogNames(db, kind) {
  return db
    .prepare(
      "SELECT name FROM catalog_options WHERE kind = ? ORDER BY sort_order ASC, name ASC",
    )
    .all(kind)
    .map((row) => row.name);
}

function serializeSetting(value) {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

export function saveSetting(db, key, value) {
  setMeta(db, key, serializeSetting(value));
}

/** All settings, typed. A default that no longer exists in its list falls back to the first option. */
export function getSettings(db) {
  const settings = {};
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
    const stored = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    const value = stored ? coerceSetting(spec, stored.value) : null;
    settings[key] = value ?? spec.initial;
    if (spec.type === "choice") {
      const options = listCatalogNames(db, spec.kind);
      if (!options.includes(settings[key])) settings[key] = options[0] ?? "";
    }
  }
  return settings;
}

export function getCatalog(db) {
  const settings = getSettings(db);
  return {
    categories: listCatalogNames(db, "category"),
    locations: listCatalogNames(db, "location"),
    package_types: listCatalogNames(db, "package_type"),
    defaults: {
      category: settings.default_category,
      location: settings.default_location,
      package_type: settings.default_package_type,
    },
  };
}

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function nextId(db, seqKey, table, column) {
  const seqRow = db
    .prepare("SELECT CAST(value AS INTEGER) AS n FROM meta WHERE key = ?")
    .get(seqKey);
  const maxRow = db
    .prepare(`SELECT COALESCE(MAX(${column}), 0) AS n FROM ${table}`)
    .get();
  return Math.max(seqRow?.n ?? 0, maxRow?.n ?? 0) + 1;
}

export function nextProductId(db) {
  return nextId(db, "product_id_seq", "products", "product_id");
}

export function nextCompanyId(db) {
  return nextId(db, "company_id_seq", "companies", "company_id");
}

export function nextBatchId(db) {
  return nextId(db, "batch_id_seq", "batches", "batch_id");
}

export function setProductIdSeq(db, productId) {
  setMeta(db, "product_id_seq", productId);
}

export function setCompanyIdSeq(db, companyId) {
  setMeta(db, "company_id_seq", companyId);
}

export function setBatchIdSeq(db, batchId) {
  setMeta(db, "batch_id_seq", batchId);
  setMeta(db, "id_seq", batchId);
}

export function logStockEvent(db, { productId, batchId, kind, delta, countAfter, createdAt }) {
  if (!delta) return;
  db.prepare(
    `INSERT INTO stock_events (product_id, batch_id, kind, delta, count_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(productId, batchId, kind, delta, countAfter, createdAt || new Date().toISOString());
}

export function listStockEvents(db, productId, limit = config.historyLimit) {
  return db
    .prepare(
      `SELECT event_id, batch_id, kind, delta, count_after, created_at
       FROM stock_events WHERE product_id = ?
       ORDER BY created_at DESC, event_id DESC LIMIT ?`,
    )
    .all(productId, limit);
}

export function findOrCreateCompany(db, brandName) {
  const name = String(brandName ?? "").trim();
  if (!name) return null;
  const nameKey = normalizeKey(name);
  const existing = db
    .prepare("SELECT company_id, name FROM companies WHERE name_key = ?")
    .get(nameKey);
  if (existing) return { company_id: existing.company_id, name: existing.name };
  const companyId = nextCompanyId(db);
  db.prepare(
    "INSERT INTO companies (company_id, name, name_key) VALUES (?, ?, ?)",
  ).run(companyId, name, nameKey);
  setCompanyIdSeq(db, companyId);
  return { company_id: companyId, name };
}

export function findProductByNameCategory(db, name, category) {
  const nameKey = normalizeKey(name);
  const cat = String(category ?? "").trim();
  return db
    .prepare(
      "SELECT * FROM products WHERE name_key = ? AND lower(category) = lower(?) LIMIT 1",
    )
    .get(nameKey, cat);
}

function foldAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function compactKey(value) {
  return foldAccents(value).replace(/[^a-z0-9]/g, "");
}

function nameTokens(value) {
  return new Set(
    foldAccents(value)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1)
      .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t)),
  );
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 score for "probably the same product" between two names. */
export function nameSimilarity(a, b) {
  const ca = compactKey(a);
  const cb = compactKey(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const stem = (s) => (s.length > 3 && s.endsWith("s") ? s.slice(0, -1) : s);
  if (stem(ca) === stem(cb)) return 0.95;

  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = shorter === ca ? cb : ca;
  const contains = shorter.length >= 4 && longer.includes(shorter) ? 0.85 : 0;

  const ratio = 1 - levenshtein(ca, cb) / Math.max(ca.length, cb.length);

  const ta = nameTokens(a);
  const tb = nameTokens(b);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? shared / union : 0;

  return Math.max(contains, ratio, jaccard);
}

/**
 * Existing products that look like the same thing as `name`.
 * An exact name+category match is flagged with `exact: true`.
 */
export function findSimilarProducts(
  db,
  name,
  category,
  { limit = config.similarLimit, threshold = config.similarityThreshold } = {},
) {
  const nameKey = normalizeKey(name);
  const cat = String(category ?? "").trim().toLowerCase();
  if (!nameKey) return [];
  const scored = [];
  for (const product of listProducts(db)) {
    const sameCategory = product.category.toLowerCase() === cat;
    const exact = sameCategory && normalizeKey(product.name) === nameKey;
    const score = exact ? 1 : nameSimilarity(name, product.name);
    const needed = sameCategory ? threshold : config.similarityAcrossCategories;
    if (exact || score >= needed) {
      scored.push({ ...product, score: Number(score.toFixed(2)), exact, same_category: sameCategory });
    }
  }
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || b.purchase_count - a.purchase_count);
  return scored.slice(0, limit);
}

export function pruneCompany(db, companyId) {
  if (!companyId) return;
  const used = db
    .prepare("SELECT COUNT(*) AS n FROM batches WHERE company_id = ?")
    .get(companyId);
  if ((used?.n ?? 0) === 0) {
    db.prepare("DELETE FROM companies WHERE company_id = ?").run(companyId);
  }
}

export function rowToBatch(row) {
  if (!row) return null;
  return {
    batch_id: row.batch_id,
    product_id: row.product_id,
    company_id: row.company_id ?? null,
    company: row.company_name ?? "",
    location: row.location ?? "",
    package_type: row.package_type ?? "",
    package_count: Number(row.package_count) || 0,
    units_per_package: row.units_per_package ?? "",
    size_value: row.size_value ?? "",
    size_unit: row.size_unit ?? "",
    expiry_date: row.expiry_date ?? "",
    notes: row.notes ?? "",
    acquired_on: row.acquired_on ?? "",
    last_updated: row.last_updated ?? "",
  };
}

const BATCH_SELECT = `
  SELECT b.*, c.name AS company_name
  FROM batches b
  LEFT JOIN companies c ON c.company_id = b.company_id
`;

export function getBatch(db, batchId) {
  const row = db.prepare(`${BATCH_SELECT} WHERE b.batch_id = ?`).get(batchId);
  return rowToBatch(row);
}

export function listBatchesForProduct(db, productId) {
  const rows = db
    .prepare(`${BATCH_SELECT} WHERE b.product_id = ? ORDER BY b.batch_id ASC`)
    .all(productId);
  return rows.map(rowToBatch);
}

export function productSummary(db, productRow, batches = null) {
  if (!productRow) return null;
  const batchRows =
    batches ?? listBatchesForProduct(db, productRow.product_id);
  const companies = [];
  const seen = new Set();
  const batchNotes = [];
  const seenNotes = new Set();
  const productNotes = String(productRow.notes ?? "").trim().toLowerCase();
  let onHand = 0;
  let nextExpiry = "";
  for (const batch of batchRows) {
    onHand += batch.package_count;
    const note = String(batch.notes ?? "").trim();
    const noteKey = note.toLowerCase();
    if (note && noteKey !== productNotes && !seenNotes.has(noteKey)) {
      seenNotes.add(noteKey);
      batchNotes.push(note);
    }
    if (batch.company) {
      const key = batch.company.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        companies.push(batch.company);
      }
    }
    if (batch.expiry_date) {
      if (!nextExpiry || batch.expiry_date < nextExpiry) {
        nextExpiry = batch.expiry_date;
      }
    }
  }
  return {
    product_id: productRow.product_id,
    name: productRow.name ?? "",
    category: productRow.category ?? "",
    notes: productRow.notes ?? "",
    last_updated: productRow.last_updated ?? "",
    on_hand: onHand,
    purchase_count: batchRows.length,
    companies,
    batch_notes: batchNotes,
    next_expiry: nextExpiry,
  };
}

export function getProduct(db, productId) {
  const row = db.prepare("SELECT * FROM products WHERE product_id = ?").get(productId);
  if (!row) return null;
  const batches = listBatchesForProduct(db, productId);
  return {
    ...productSummary(db, row, batches),
    batches,
  };
}

export function listProducts(db) {
  const products = db
    .prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE ASC, product_id ASC")
    .all();
  return products.map((row) => productSummary(db, row));
}

export function listCompanies(db) {
  return db
    .prepare("SELECT company_id, name FROM companies ORDER BY name COLLATE NOCASE ASC")
    .all();
}

/** Flat batch records (one row per batch) for reports and the /items API. */
export function listBatchRecords(db) {
  const rows = db
    .prepare(
      `
      SELECT
        b.batch_id AS item_id,
        b.batch_id,
        p.product_id,
        p.name,
        COALESCE(c.name, '') AS brand,
        COALESCE(c.name, '') AS company,
        p.category,
        b.location,
        b.package_type,
        b.package_count,
        b.units_per_package,
        b.size_value,
        b.size_unit,
        b.expiry_date,
        COALESCE(p.notes, '') AS notes,
        COALESCE(b.notes, '') AS batch_notes,
        b.acquired_on,
        b.last_updated,
        (
          SELECT COUNT(*) FROM batches b2 WHERE b2.product_id = p.product_id
        ) AS purchase_count
      FROM batches b
      JOIN products p ON p.product_id = b.product_id
      LEFT JOIN companies c ON c.company_id = b.company_id
      ORDER BY b.batch_id ASC
    `,
    )
    .all();
  return rows.map((row) => ({
    item_id: row.item_id,
    batch_id: row.batch_id,
    product_id: row.product_id,
    name: row.name ?? "",
    brand: row.brand ?? "",
    company: row.company ?? "",
    category: row.category ?? "",
    location: row.location ?? "",
    package_type: row.package_type ?? "",
    package_count: Number(row.package_count) || 0,
    units_per_package: row.units_per_package ?? "",
    size_value: row.size_value ?? "",
    size_unit: row.size_unit ?? "",
    expiry_date: row.expiry_date ?? "",
    notes: row.notes ?? "",
    batch_notes: row.batch_notes ?? "",
    acquired_on: row.acquired_on ?? "",
    last_updated: row.last_updated ?? "",
    purchase_count: Number(row.purchase_count) || 0,
  }));
}
