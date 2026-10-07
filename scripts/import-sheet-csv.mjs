#!/usr/bin/env node
/**
 * Import a Google Sheets inventory CSV into the local SQLite database,
 * grouping same-name+category rows into products with purchase batches.
 *
 * Usage:
 *   node scripts/import-sheet-csv.mjs [path/to/inventory-export.csv]
 *
 * Default CSV path: data/inventory-export.csv
 * Default DB path:  data/inventory.sqlite (or INVENTORY_DATA_DIR)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDb,
  findOrCreateCompany,
  findProductByNameCategory,
  getBatch,
  listProducts,
  nextBatchId,
  nextProductId,
  normalizeKey,
  setBatchIdSeq,
  setProductIdSeq,
  todayStamp,
} from "../server/src/db.js";
import { loadDotEnv } from "../server/src/env.js";
import { coerceDate, normalizeSheetRow, parseId } from "../server/src/validate.js";

loadDotEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.INVENTORY_DATA_DIR || path.join(ROOT, "data");
const csvPath = path.resolve(
  process.argv[2] || path.join(DATA_DIR, "inventory-export.csv"),
);
const dbPath = path.join(DATA_DIR, "inventory.sqlite");

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = cells[i] ?? "";
    });
    if (!Object.values(row).some((value) => String(value).trim())) continue;
    rows.push({
      item_id: row.item_id ? Number.parseInt(row.item_id, 10) : undefined,
      name: row.name,
      brand: row.brand,
      category: row.category,
      location: row.location,
      package_type: row.package_type,
      package_count: row.package_count
        ? Number.parseInt(row.package_count, 10)
        : undefined,
      units_per_package: row.units_per_package,
      size_value: row.size_value,
      size_unit: row.size_unit,
      expiry_date: row.expiry_date,
      notes: row.notes,
      last_updated: row.last_updated,
      acquired_on: row.acquired_on || row.last_updated,
    });
  }
  return rows;
}

function coerceImportedStamp(value) {
  if (!value) return todayStamp();
  const textValue = String(value).trim().replace(/^'/, "");
  const coerced = coerceDate(textValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(coerced)) return coerced;
  return todayStamp();
}

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  console.error(
    "Export the Google Sheet tab as CSV (File → Download → CSV) and save it there.",
  );
  process.exit(1);
}

const text = fs.readFileSync(csvPath, "utf8");
const rows = parseCsv(text);
if (!rows.length) {
  console.error("No data rows found in CSV.");
  process.exit(1);
}

const db = createDb(dbPath);

const insertProductStmt = db.prepare(`
  INSERT INTO products (product_id, name, name_key, category, notes, last_updated)
  VALUES (@product_id, @name, @name_key, @category, @notes, @last_updated)
`);
const insertBatchStmt = db.prepare(`
  INSERT INTO batches (
    batch_id, product_id, company_id, location, package_type, package_count,
    units_per_package, size_value, size_unit, expiry_date, notes, acquired_on, last_updated
  ) VALUES (
    @batch_id, @product_id, @company_id, @location, @package_type, @package_count,
    @units_per_package, @size_value, @size_unit, @expiry_date, @notes, @acquired_on, @last_updated
  )
`);
const updateBatchStmt = db.prepare(`
  UPDATE batches SET
    company_id = @company_id,
    location = @location,
    package_type = @package_type,
    package_count = @package_count,
    units_per_package = @units_per_package,
    size_value = @size_value,
    size_unit = @size_unit,
    expiry_date = @expiry_date,
    notes = @notes,
    acquired_on = @acquired_on,
    last_updated = @last_updated
  WHERE batch_id = @batch_id
`);

const importTx = db.transaction((incoming) => {
  let imported = 0;
  for (const raw of incoming) {
    const { product, batch } = normalizeSheetRow(db, raw);
    const acquired = coerceImportedStamp(raw.acquired_on ?? raw.last_updated);
    const preferredBatchId = parseId(raw.item_id ?? raw.batch_id);

    let productRow = findProductByNameCategory(db, product.name, product.category);
    if (!productRow) {
      const productId = nextProductId(db);
      insertProductStmt.run({
        product_id: productId,
        name: product.name,
        name_key: normalizeKey(product.name),
        category: product.category,
        notes: product.notes ?? "",
        last_updated: acquired,
      });
      setProductIdSeq(db, productId);
      productRow = db
        .prepare("SELECT * FROM products WHERE product_id = ?")
        .get(productId);
    } else if (!productRow.notes && product.notes) {
      db.prepare("UPDATE products SET notes = ? WHERE product_id = ?").run(
        product.notes,
        productRow.product_id,
      );
    }

    const company = findOrCreateCompany(db, batch.company);
    const stamp = todayStamp();
    const batchRow = {
      batch_id: preferredBatchId || nextBatchId(db),
      product_id: productRow.product_id,
      company_id: company?.company_id ?? null,
      location: batch.location ?? "",
      package_type: batch.package_type ?? "",
      package_count: batch.package_count ?? 1,
      units_per_package: batch.units_per_package ?? "",
      size_value: batch.size_value ?? "",
      size_unit: batch.size_unit ?? "",
      expiry_date: batch.expiry_date ?? "",
      notes: batch.notes ?? "",
      acquired_on: acquired,
      last_updated: stamp,
    };

    if (preferredBatchId && getBatch(db, preferredBatchId)) {
      updateBatchStmt.run(batchRow);
    } else {
      insertBatchStmt.run(batchRow);
    }
    setBatchIdSeq(db, batchRow.batch_id);
    imported += 1;
  }
  return imported;
});

const imported = importTx(rows);
const products = listProducts(db);
const multi = products.filter((p) => p.purchase_count > 1).length;
const companies = db.prepare("SELECT COUNT(*) AS n FROM companies").get()?.n ?? 0;
const batchCount = db.prepare("SELECT COUNT(*) AS n FROM batches").get()?.n ?? 0;

console.log(`Imported ${imported} sheet row(s) into ${dbPath}`);
console.log(`Products: ${products.length}`);
console.log(`Batches (purchases): ${batchCount}`);
console.log(`Companies: ${companies}`);
console.log(`Products with more than one purchase: ${multi}`);
