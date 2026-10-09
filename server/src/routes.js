import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { SETTINGS_SCHEMA, coerceSetting, parseKind } from "./catalog.js";
import { config } from "./config.js";
import {
  exportBackup,
  findOrCreateCompany,
  findProductByNameCategory,
  findSimilarProducts,
  getBatch,
  getCatalog,
  getProduct,
  getSettings,
  listBatchRecords,
  listBatchesForProduct,
  listCatalogNames,
  listCompanies,
  listProducts,
  listStockEvents,
  logStockEvent,
  nextBatchId,
  nextProductId,
  normalizeKey,
  pruneCompany,
  restoreBackup,
  saveSetting,
  setBatchIdSeq,
  setMeta,
  setProductIdSeq,
  todayStamp,
} from "./db.js";
import { ALLOWED_IMAGE_TYPES, extractItem } from "./extract.js";
import {
  batchFieldsSource,
  coerceDate,
  normalizeBatch,
  normalizeProduct,
  normalizeSheetRow,
  parseBatchId,
  parseId,
  parseProductId,
} from "./validate.js";

// Built per router so the size limit is read after .env has been loaded.
const createUpload = () => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_TYPES.has(String(file.mimetype || "").toLowerCase())) {
      cb(null, true);
      return;
    }
    const err = new Error("Image must be JPEG, PNG, or WebP.");
    err.status = 400;
    cb(err);
  },
});

function daysUntil(iso) {
  const text = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const target = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayUtc) / 86400000);
}

function sendError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Unexpected error" });
}

function notFound(message = "Not found.") {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function coerceImportedStamp(value) {
  if (!value) return todayStamp();
  const text = String(value).trim().replace(/^'/, "");
  const coerced = coerceDate(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(coerced)) return coerced;
  return todayStamp();
}

function countBy(items, field) {
  const counts = new Map();
  for (const item of items) {
    const key = item[field] || "Unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([name, value]) => ({ name, value }));
}

export function createRouter(db) {
  const router = Router();
  const upload = createUpload();
  const backupUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxBackupBytes, files: 1 },
  });

  const insertProductStmt = db.prepare(`
    INSERT INTO products (product_id, name, name_key, category, notes, last_updated)
    VALUES (@product_id, @name, @name_key, @category, @notes, @last_updated)
  `);

  const updateProductStmt = db.prepare(`
    UPDATE products SET
      name = @name,
      name_key = @name_key,
      category = @category,
      notes = @notes,
      last_updated = @last_updated
    WHERE product_id = @product_id
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

  const deleteBatchStmt = db.prepare("DELETE FROM batches WHERE batch_id = ?");
  const deleteProductStmt = db.prepare("DELETE FROM products WHERE product_id = ?");

  function insertBatchRow(productId, batchFields, { batchId = null, acquiredOn = null } = {}) {
    const id = batchId || nextBatchId(db);
    const company = findOrCreateCompany(db, batchFields.company);
    const stamp = todayStamp();
    const acquired = acquiredOn || batchFields.acquired_on || stamp;
    const row = {
      batch_id: id,
      product_id: productId,
      company_id: company?.company_id ?? null,
      location: batchFields.location ?? "",
      package_type: batchFields.package_type ?? "",
      package_count: batchFields.package_count ?? 1,
      units_per_package: batchFields.units_per_package ?? "",
      size_value: batchFields.size_value ?? "",
      size_unit: batchFields.size_unit ?? "",
      expiry_date: batchFields.expiry_date ?? "",
      notes: batchFields.notes ?? "",
      acquired_on: acquired,
      last_updated: stamp,
    };
    insertBatchStmt.run(row);
    setBatchIdSeq(db, id);
    logStockEvent(db, {
      productId,
      batchId: id,
      kind: "purchase",
      delta: row.package_count,
      countAfter: row.package_count,
      // Imports carry their original purchase date; anything dated today gets the real time.
      createdAt: acquired === stamp ? undefined : `${acquired}T00:00:00.000Z`,
    });
    db.prepare("UPDATE products SET last_updated = ? WHERE product_id = ?").run(
      stamp,
      productId,
    );
    return getBatch(db, id);
  }

  const createProductWithBatch = db.transaction((productFields, batchFields) => {
    const existing = findProductByNameCategory(
      db,
      productFields.name,
      productFields.category,
    );
    if (existing) {
      addOrTopUpBatch(existing.product_id, batchFields);
      if (!existing.notes && productFields.notes) {
        db.prepare(
          "UPDATE products SET notes = ?, last_updated = ? WHERE product_id = ?",
        ).run(productFields.notes, todayStamp(), existing.product_id);
      }
      return getProduct(db, existing.product_id);
    }
    const productId = nextProductId(db);
    const stamp = todayStamp();
    insertProductStmt.run({
      product_id: productId,
      name: productFields.name,
      name_key: normalizeKey(productFields.name),
      category: productFields.category,
      notes: productFields.notes ?? "",
      last_updated: stamp,
    });
    setProductIdSeq(db, productId);
    insertBatchRow(productId, batchFields);
    return getProduct(db, productId);
  });

  // A purchase identical to one already on the shelf (same company, place,
  // package, size, expiry and note) raises that batch's count instead of
  // adding a second row. The acquired date is not part of the comparison.
  function findSameBatch(productId, batchFields) {
    const text = (value) => String(value ?? "").trim();
    const companyKey = normalizeKey(batchFields.company);
    return listBatchesForProduct(db, productId).find(
      (batch) =>
        normalizeKey(batch.company) === companyKey &&
        text(batch.location) === text(batchFields.location) &&
        text(batch.package_type) === text(batchFields.package_type) &&
        text(batch.units_per_package) === text(batchFields.units_per_package) &&
        text(batch.size_value) === text(batchFields.size_value) &&
        text(batch.size_unit) === text(batchFields.size_unit) &&
        text(batch.expiry_date) === text(batchFields.expiry_date) &&
        text(batch.notes) === text(batchFields.notes),
    );
  }

  function addOrTopUpBatch(productId, batchFields) {
    const same = findSameBatch(productId, batchFields);
    if (!same) return insertBatchRow(productId, batchFields);
    const added = batchFields.package_count ?? 1;
    return updateBatchTx(
      same.batch_id,
      { package_count: same.package_count + added },
      { kind: "purchase" },
    );
  }

  const updateProductTx = db.transaction((productId, patch) => {
    const current = db
      .prepare("SELECT * FROM products WHERE product_id = ?")
      .get(productId);
    if (!current) throw notFound("Product not found.");
    const merged = {
      name: patch.name !== undefined ? patch.name : current.name,
      category: patch.category !== undefined ? patch.category : current.category,
      notes: patch.notes !== undefined ? patch.notes : current.notes,
    };
    const conflict = findProductByNameCategory(db, merged.name, merged.category);
    if (conflict && conflict.product_id !== productId) {
      throw badRequest(
        `Another product already uses name "${merged.name}" in category "${merged.category}".`,
      );
    }
    updateProductStmt.run({
      product_id: productId,
      name: merged.name,
      name_key: normalizeKey(merged.name),
      category: merged.category,
      notes: merged.notes,
      last_updated: todayStamp(),
    });
    return getProduct(db, productId);
  });

  const addBatchTx = db.transaction((productId, batchFields) => {
    const product = db
      .prepare("SELECT product_id FROM products WHERE product_id = ?")
      .get(productId);
    if (!product) throw notFound("Product not found.");
    addOrTopUpBatch(productId, batchFields);
    return getProduct(db, productId);
  });

  const updateBatchTx = db.transaction((batchId, patch, { kind } = {}) => {
    const current = getBatch(db, batchId);
    if (!current) throw notFound("Batch not found.");
    const oldCompanyId = current.company_id;
    const merged = {
      company:
        patch.company !== undefined ? patch.company : current.company,
      location: patch.location !== undefined ? patch.location : current.location,
      package_type:
        patch.package_type !== undefined ? patch.package_type : current.package_type,
      package_count:
        patch.package_count !== undefined
          ? patch.package_count
          : current.package_count,
      units_per_package:
        patch.units_per_package !== undefined
          ? patch.units_per_package
          : current.units_per_package,
      size_value:
        patch.size_value !== undefined ? patch.size_value : current.size_value,
      size_unit:
        patch.size_unit !== undefined ? patch.size_unit : current.size_unit,
      expiry_date:
        patch.expiry_date !== undefined ? patch.expiry_date : current.expiry_date,
      notes: patch.notes !== undefined ? patch.notes : current.notes,
      acquired_on:
        patch.acquired_on !== undefined ? patch.acquired_on : current.acquired_on,
    };
    const company = findOrCreateCompany(db, merged.company);
    const stamp = todayStamp();
    updateBatchStmt.run({
      batch_id: batchId,
      company_id: company?.company_id ?? null,
      location: merged.location,
      package_type: merged.package_type,
      package_count: merged.package_count,
      units_per_package: merged.units_per_package,
      size_value: merged.size_value,
      size_unit: merged.size_unit,
      expiry_date: merged.expiry_date,
      notes: merged.notes,
      acquired_on: merged.acquired_on || stamp,
      last_updated: stamp,
    });
    if (oldCompanyId && oldCompanyId !== (company?.company_id ?? null)) {
      pruneCompany(db, oldCompanyId);
    }
    const delta = merged.package_count - current.package_count;
    if (delta) {
      logStockEvent(db, {
        productId: current.product_id,
        batchId,
        kind: kind || (delta < 0 ? "used" : "added"),
        delta,
        countAfter: merged.package_count,
      });
    }
    db.prepare("UPDATE products SET last_updated = ? WHERE product_id = ?").run(
      stamp,
      current.product_id,
    );
    return getBatch(db, batchId);
  });

  const deleteBatchTx = db.transaction((batchId) => {
    const current = getBatch(db, batchId);
    if (!current) throw notFound("Batch not found.");
    const productId = current.product_id;
    const companyId = current.company_id;
    logStockEvent(db, {
      productId,
      batchId,
      kind: "removed",
      delta: -current.package_count,
      countAfter: 0,
    });
    deleteBatchStmt.run(batchId);
    pruneCompany(db, companyId);
    const remaining = listBatchesForProduct(db, productId);
    if (remaining.length === 0) {
      deleteProductStmt.run(productId);
      return { ok: true, batch_id: batchId, product_deleted: true };
    }
    db.prepare("UPDATE products SET last_updated = ? WHERE product_id = ?").run(
      todayStamp(),
      productId,
    );
    return { ok: true, batch_id: batchId, product_deleted: false };
  });

  const mergeProductsTx = db.transaction((sourceId, targetId) => {
    if (sourceId === targetId) throw badRequest("Cannot merge a product into itself.");
    const source = db.prepare("SELECT * FROM products WHERE product_id = ?").get(sourceId);
    if (!source) throw notFound("Product to merge not found.");
    const target = db.prepare("SELECT * FROM products WHERE product_id = ?").get(targetId);
    if (!target) throw notFound("Target product not found.");

    db.prepare("UPDATE batches SET product_id = ? WHERE product_id = ?").run(targetId, sourceId);
    db.prepare("UPDATE stock_events SET product_id = ? WHERE product_id = ?").run(
      targetId,
      sourceId,
    );
    const notes = target.notes || source.notes || "";
    db.prepare("UPDATE products SET notes = ?, last_updated = ? WHERE product_id = ?").run(
      notes,
      todayStamp(),
      targetId,
    );
    deleteProductStmt.run(sourceId);
    return getProduct(db, targetId);
  });

  const consumeTx = db.transaction((productId, amount) => {
    const product = db.prepare("SELECT product_id FROM products WHERE product_id = ?").get(productId);
    if (!product) throw notFound("Product not found.");
    const pick = db.prepare(`
      SELECT batch_id, package_count FROM batches
      WHERE product_id = ? AND package_count > 0
      ORDER BY CASE WHEN expiry_date = '' THEN 1 ELSE 0 END, expiry_date ASC,
               acquired_on ASC, batch_id ASC
      LIMIT 1
    `);
    let remaining = amount;
    const used = [];
    while (remaining > 0) {
      const batch = pick.get(productId);
      if (!batch) break;
      const take = Math.min(remaining, batch.package_count);
      updateBatchTx(batch.batch_id, { package_count: batch.package_count - take });
      used.push({ batch_id: batch.batch_id, used: take });
      remaining -= take;
    }
    if (!used.length) throw badRequest("Nothing left to use up for this product.");
    return { product: getProduct(db, productId), used };
  });

  const restockTx = db.transaction((productId, amount) => {
    const newest = db
      .prepare(
        `SELECT batch_id, package_count FROM batches WHERE product_id = ?
         ORDER BY acquired_on DESC, batch_id DESC LIMIT 1`,
      )
      .get(productId);
    if (!newest) throw notFound("Product not found.");
    updateBatchTx(newest.batch_id, { package_count: newest.package_count + amount });
    return { product: getProduct(db, productId), batch_id: newest.batch_id };
  });

  const importSheetRows = db.transaction((incoming) => {
    const createdBatches = [];
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

      if (preferredBatchId) {
        const existing = getBatch(db, preferredBatchId);
        if (existing) {
          const company = findOrCreateCompany(db, batch.company);
          updateBatchStmt.run({
            batch_id: preferredBatchId,
            company_id: company?.company_id ?? null,
            location: batch.location,
            package_type: batch.package_type,
            package_count: batch.package_count,
            units_per_package: batch.units_per_package,
            size_value: batch.size_value,
            size_unit: batch.size_unit,
            expiry_date: batch.expiry_date,
            notes: batch.notes,
            acquired_on: acquired,
            last_updated: todayStamp(),
          });
          createdBatches.push(getBatch(db, preferredBatchId));
          continue;
        }
        insertBatchRow(productRow.product_id, batch, {
          batchId: preferredBatchId,
          acquiredOn: acquired,
        });
        createdBatches.push(getBatch(db, preferredBatchId));
      } else {
        const created = insertBatchRow(productRow.product_id, batch, {
          acquiredOn: acquired,
        });
        createdBatches.push(created);
      }
    }

    const maxBatch = db
      .prepare("SELECT COALESCE(MAX(batch_id), 0) AS n FROM batches")
      .get();
    setBatchIdSeq(db, maxBatch?.n ?? 0);
    return createdBatches;
  });

  // --- Gemini extract (photo → draft product fields) ---

  router.post("/extract", (req, res) => {
    upload.single("image")(req, res, async (uploadErr) => {
      if (uploadErr) {
        sendError(res, uploadErr);
        return;
      }
      try {
        if (!req.file) throw badRequest("Image is required.");
        const catalog = getCatalog(db);
        const settings = getSettings(db);
        const item = await extractItem({
          imageBuffer: req.file.buffer,
          mimeType: req.file.mimetype,
          caption: String(req.body?.caption ?? ""),
          catalog,
          settings,
        });
        res.json({ item });
      } catch (err) {
        sendError(res, err);
      }
    });
  });

  // --- Catalog & settings (unchanged shape) ---

  router.get("/catalog", (_req, res) => {
    try {
      res.json(getCatalog(db));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/catalog/:kind", (req, res) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) throw badRequest("Invalid catalog kind.");
      const name = String(req.body?.name ?? "").trim();
      if (!name) throw badRequest("Name is required.");
      const existing = listCatalogNames(db, kind);
      if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) {
        throw badRequest("That option already exists.");
      }
      const maxOrder = db
        .prepare(
          "SELECT COALESCE(MAX(sort_order), -1) AS n FROM catalog_options WHERE kind = ?",
        )
        .get(kind);
      db.prepare(
        "INSERT INTO catalog_options (kind, name, sort_order) VALUES (?, ?, ?)",
      ).run(kind, name, (maxOrder?.n ?? -1) + 1);
      res.status(201).json(getCatalog(db));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch("/catalog/:kind", (req, res) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) throw badRequest("Invalid catalog kind.");
      const from = String(req.body?.from ?? "").trim();
      const to = String(req.body?.to ?? "").trim();
      if (!from || !to) throw badRequest("Provide from and to names.");
      if (from === to) return res.json(getCatalog(db));

      const names = listCatalogNames(db, kind);
      if (!names.includes(from)) throw badRequest("Option not found.");
      if (names.some((n) => n.toLowerCase() === to.toLowerCase() && n !== from)) {
        throw badRequest("That option already exists.");
      }

      const rename = db.transaction(() => {
        const row = db
          .prepare("SELECT sort_order FROM catalog_options WHERE kind = ? AND name = ?")
          .get(kind, from);
        db.prepare("DELETE FROM catalog_options WHERE kind = ? AND name = ?").run(
          kind,
          from,
        );
        db.prepare(
          "INSERT INTO catalog_options (kind, name, sort_order) VALUES (?, ?, ?)",
        ).run(kind, to, row?.sort_order ?? 0);

        if (kind === "category") {
          db.prepare("UPDATE products SET category = ? WHERE category = ?").run(to, from);
        } else if (kind === "location") {
          db.prepare("UPDATE batches SET location = ? WHERE location = ?").run(to, from);
        } else if (kind === "package_type") {
          db.prepare("UPDATE batches SET package_type = ? WHERE package_type = ?").run(
            to,
            from,
          );
        }

        const settings = getSettings(db);
        if (kind === "category" && settings.default_category === from) {
          setMeta(db, "default_category", to);
        }
        if (kind === "location" && settings.default_location === from) {
          setMeta(db, "default_location", to);
        }
        if (kind === "package_type" && settings.default_package_type === from) {
          setMeta(db, "default_package_type", to);
        }
      });
      rename();
      res.json(getCatalog(db));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/catalog/:kind", (req, res) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) throw badRequest("Invalid catalog kind.");
      const name = String(req.query.name ?? "").trim();
      if (!name) throw badRequest("Provide name query param.");
      const names = listCatalogNames(db, kind);
      if (!names.includes(name)) throw badRequest("Option not found.");

      let inUse;
      if (kind === "category") {
        inUse = db
          .prepare("SELECT COUNT(*) AS n FROM products WHERE category = ?")
          .get(name);
      } else if (kind === "location") {
        inUse = db
          .prepare("SELECT COUNT(*) AS n FROM batches WHERE location = ?")
          .get(name);
      } else {
        inUse = db
          .prepare("SELECT COUNT(*) AS n FROM batches WHERE package_type = ?")
          .get(name);
      }
      if ((inUse?.n ?? 0) > 0) {
        throw badRequest(
          `Cannot delete "${name}" — ${inUse.n} row(s) still use it. Rename first.`,
        );
      }

      const settings = getSettings(db);
      if (kind === "category" && settings.default_category === name) {
        throw badRequest(
          "Cannot delete the default category. Change defaults in Settings first.",
        );
      }
      if (kind === "location" && settings.default_location === name) {
        throw badRequest(
          "Cannot delete the default location. Change defaults in Settings first.",
        );
      }
      if (kind === "package_type" && settings.default_package_type === name) {
        throw badRequest(
          "Cannot delete the default package type. Change defaults in Settings first.",
        );
      }

      db.prepare("DELETE FROM catalog_options WHERE kind = ? AND name = ?").run(
        kind,
        name,
      );
      res.json(getCatalog(db));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/settings", (_req, res) => {
    try {
      res.json(getSettings(db));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch("/settings", (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const save = db.transaction(() => {
        for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
          if (body[key] === undefined) continue;
          const value = coerceSetting(spec, body[key]);
          if (value === null) throw badRequest(`${key} is not a valid value.`);
          if (spec.type === "choice" && !listCatalogNames(db, spec.kind).includes(value)) {
            throw badRequest(`${key} must be one of the existing options.`);
          }
          saveSetting(db, key, value);
        }
      });
      save();
      res.json(getSettings(db));
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- Products ---

  router.get("/products", (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim().toLowerCase();
      const category = String(req.query.category ?? "").trim();
      const location = String(req.query.location ?? "").trim();
      const company = String(req.query.company ?? "").trim().toLowerCase();
      let products = listProducts(db);
      if (category) {
        products = products.filter((p) => p.category === category);
      }
      if (location) {
        products = products.filter((p) => {
          const batches = listBatchesForProduct(db, p.product_id);
          return batches.some((b) => b.location === location);
        });
      }
      if (company) {
        products = products.filter((p) =>
          p.companies.some((c) => c.toLowerCase().includes(company)),
        );
      }
      if (q) {
        products = products.filter((p) => {
          const hay = [p.name, p.category, p.notes, ...p.companies, ...p.batch_notes]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
      }
      res.json({ products });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/products/similar", (req, res) => {
    try {
      const name = String(req.query.name ?? "").trim();
      const category = String(req.query.category ?? "").trim();
      if (!name) throw badRequest("Provide a name.");
      res.json({ products: findSimilarProducts(db, name, category) });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/products/:id/merge", (req, res) => {
    try {
      const sourceId = parseProductId(req.params.id);
      const targetId = parseProductId(req.body?.into);
      if (!sourceId || !targetId) throw badRequest("Provide a valid product id and `into`.");
      res.json(mergeProductsTx(sourceId, targetId));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/products/:id/consume", (req, res) => {
    try {
      const productId = parseProductId(req.params.id);
      if (!productId) throw badRequest("Invalid product id.");
      const amount = Math.max(1, Number.parseInt(req.body?.amount ?? 1, 10) || 1);
      res.json(consumeTx(productId, amount));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/products/:id/restock", (req, res) => {
    try {
      const productId = parseProductId(req.params.id);
      if (!productId) throw badRequest("Invalid product id.");
      const amount = Math.max(1, Number.parseInt(req.body?.amount ?? 1, 10) || 1);
      res.json(restockTx(productId, amount));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/products/:id", (req, res) => {
    try {
      const productId = parseProductId(req.params.id);
      if (!productId) throw badRequest("Invalid product id.");
      const product = getProduct(db, productId);
      if (!product) throw notFound("Product not found.");
      res.json(product);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/products/:id/events", (req, res) => {
    try {
      const productId = parseProductId(req.params.id);
      if (!productId) throw badRequest("Invalid product id.");
      res.json({ events: listStockEvents(db, productId) });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/products", (req, res) => {
    try {
      const productFields = normalizeProduct(db, req.body);
      const batchFields = normalizeBatch(db, batchFieldsSource(req.body));
      const product = createProductWithBatch(productFields, batchFields);
      res.status(201).json(product);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch("/products/:id", (req, res) => {
    try {
      const productId = parseProductId(req.params.id);
      if (!productId) throw badRequest("Invalid product id.");
      const patch = normalizeProduct(db, req.body, { partial: true });
      const product = updateProductTx(productId, patch);
      res.json(product);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/products/:id/batches", (req, res) => {
    try {
      const productId = parseProductId(req.params.id);
      if (!productId) throw badRequest("Invalid product id.");
      const batchFields = normalizeBatch(db, req.body);
      const product = addBatchTx(productId, batchFields);
      res.status(201).json(product);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/products/:id", (req, res) => {
    try {
      const productId = parseProductId(req.params.id);
      if (!productId) throw badRequest("Invalid product id.");
      const product = getProduct(db, productId);
      if (!product) throw notFound("Product not found.");
      const remove = db.transaction(() => {
        const companyIds = product.batches
          .map((b) => b.company_id)
          .filter(Boolean);
        db.prepare("DELETE FROM batches WHERE product_id = ?").run(productId);
        deleteProductStmt.run(productId);
        for (const companyId of new Set(companyIds)) {
          pruneCompany(db, companyId);
        }
      });
      remove();
      res.json({ ok: true, product_id: productId });
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- Batches ---

  router.get("/batches/:id", (req, res) => {
    try {
      const batchId = parseBatchId(req.params.id);
      if (!batchId) throw badRequest("Invalid batch id.");
      const batch = getBatch(db, batchId);
      if (!batch) throw notFound("Batch not found.");
      res.json(batch);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch("/batches/:id", (req, res) => {
    try {
      const batchId = parseBatchId(req.params.id);
      if (!batchId) throw badRequest("Invalid batch id.");
      const patch = normalizeBatch(db, req.body, { partial: true });
      const batch = updateBatchTx(batchId, patch);
      res.json(batch);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/batches/:id/count", (req, res) => {
    try {
      const batchId = parseBatchId(req.params.id);
      if (!batchId) throw badRequest("Invalid batch id.");
      const current = getBatch(db, batchId);
      if (!current) throw notFound("Batch not found.");
      let nextCount = current.package_count;
      if (req.body?.package_count !== undefined) {
        nextCount = Math.max(0, Number.parseInt(req.body.package_count, 10) || 0);
      } else if (req.body?.delta !== undefined) {
        const delta = Number.parseInt(req.body.delta, 10);
        if (Number.isNaN(delta)) throw badRequest("delta must be an integer.");
        nextCount = Math.max(0, current.package_count + delta);
      } else {
        throw badRequest("Provide package_count or delta.");
      }
      const batch = updateBatchTx(batchId, { package_count: nextCount });
      res.json(batch);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/batches/:id", (req, res) => {
    try {
      const batchId = parseBatchId(req.params.id);
      if (!batchId) throw badRequest("Invalid batch id.");
      const result = deleteBatchTx(batchId);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/companies", (_req, res) => {
    try {
      res.json({ companies: listCompanies(db) });
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- Batch-oriented /items API (reports + flat batch rows) ---

  router.get("/items", (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim().toLowerCase();
      const category = String(req.query.category ?? "").trim();
      const location = String(req.query.location ?? "").trim();
      let items = listBatchRecords(db);
      if (category) items = items.filter((item) => item.category === category);
      if (location) items = items.filter((item) => item.location === location);
      if (q) {
        items = items.filter((item) => {
          const hay = [
            item.name,
            item.brand,
            item.category,
            item.notes,
            item.batch_notes,
            item.location,
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
      }
      res.json({ items });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/items/:id", (req, res) => {
    try {
      const batchId = parseBatchId(req.params.id);
      if (!batchId) throw badRequest("Invalid item id.");
      const records = listBatchRecords(db);
      const item = records.find((r) => r.item_id === batchId);
      if (!item) throw notFound("Item not found.");
      res.json(item);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/items", (req, res) => {
    try {
      const productFields = normalizeProduct(db, req.body);
      const batchFields = normalizeBatch(db, batchFieldsSource(req.body));
      const product = createProductWithBatch(productFields, batchFields);
      const newest = product.batches[product.batches.length - 1];
      const records = listBatchRecords(db);
      const item = records.find((r) => r.item_id === newest.batch_id);
      res.status(201).json(item);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch("/items/:id", (req, res) => {
    try {
      const batchId = parseBatchId(req.params.id);
      if (!batchId) throw badRequest("Invalid item id.");
      const current = getBatch(db, batchId);
      if (!current) throw notFound("Item not found.");

      const productPatch = normalizeProduct(db, req.body, { partial: true });
      const batchPatch = normalizeBatch(db, batchFieldsSource(req.body), { partial: true });

      if (Object.keys(productPatch).length) {
        updateProductTx(current.product_id, productPatch);
      }
      if (Object.keys(batchPatch).length) {
        updateBatchTx(batchId, batchPatch);
      }

      const records = listBatchRecords(db);
      const item = records.find((r) => r.item_id === batchId);
      res.json(item);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/items/:id/count", (req, res) => {
    try {
      const batchId = parseBatchId(req.params.id);
      if (!batchId) throw badRequest("Invalid item id.");
      const current = getBatch(db, batchId);
      if (!current) throw notFound("Item not found.");
      let nextCount = current.package_count;
      if (req.body?.package_count !== undefined) {
        nextCount = Math.max(0, Number.parseInt(req.body.package_count, 10) || 0);
      } else if (req.body?.delta !== undefined) {
        const delta = Number.parseInt(req.body.delta, 10);
        if (Number.isNaN(delta)) throw badRequest("delta must be an integer.");
        nextCount = Math.max(0, current.package_count + delta);
      } else {
        throw badRequest("Provide package_count or delta.");
      }
      updateBatchTx(batchId, { package_count: nextCount });
      const records = listBatchRecords(db);
      const item = records.find((r) => r.item_id === batchId);
      res.json(item);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/items/:id", (req, res) => {
    try {
      const batchId = parseBatchId(req.params.id);
      if (!batchId) throw badRequest("Invalid item id.");
      deleteBatchTx(batchId);
      res.json({ ok: true, item_id: batchId });
    } catch (err) {
      sendError(res, err);
    }
  });

  // --- Full backup & restore ---

  router.get("/backup", (_req, res) => {
    try {
      const backup = exportBackup(db);
      const stamp = backup.exported_at.slice(0, 10);
      res.setHeader("Content-Disposition", `attachment; filename="inventory-backup-${stamp}.json"`);
      res.json(backup);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/restore", (req, res) => {
    backupUpload.single("file")(req, res, (uploadErr) => {
      if (uploadErr) {
        sendError(res, uploadErr);
        return;
      }
      try {
        if (!req.file) throw badRequest("Choose a backup file.");
        let backup;
        try {
          backup = JSON.parse(req.file.buffer.toString("utf8"));
        } catch {
          throw badRequest("That file is not an inventory backup.");
        }
        // Keep what is about to be replaced, next to the database, in case the
        // wrong file was chosen.
        const safetyCopy = path.join(path.dirname(db.name), "before-last-restore.json");
        fs.writeFileSync(safetyCopy, JSON.stringify(exportBackup(db)));
        const restored = restoreBackup(db, backup);
        res.json({ restored, exported_at: backup.exported_at ?? "" });
      } catch (err) {
        sendError(res, err);
      }
    });
  });

  router.post("/import", (req, res) => {
    try {
      const incoming = Array.isArray(req.body?.items)
        ? req.body.items
        : Array.isArray(req.body)
          ? req.body
          : null;
      if (!incoming) {
        throw badRequest("Body must be { items: [...] } or an array.");
      }
      const batches = importSheetRows(incoming);
      const products = listProducts(db);
      const multiPurchase = products.filter((p) => p.purchase_count > 1).length;
      res.json({
        imported: batches.length,
        batches,
        products: products.length,
        multi_purchase_products: multiPurchase,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/stats", (_req, res) => {
    try {
      const products = listProducts(db);
      const batches = listBatchRecords(db);
      const byCategory = countBy(products, "category");
      const byLocation = countBy(batches, "location");
      const byCompany = countBy(
        batches.map((b) => ({ company: b.company || "Unknown" })),
        "company",
      );
      const soonDays = getSettings(db).expiring_soon_days;
      const expired = [];
      const expiringSoon = [];
      let zeroCount = 0;
      for (const batch of batches) {
        if (batch.package_count <= 0) zeroCount += 1;
        const days = daysUntil(batch.expiry_date);
        if (days == null) continue;
        const entry = {
          batch_id: batch.batch_id,
          product_id: batch.product_id,
          name: batch.name,
          company: batch.company,
          location: batch.location,
          expiry_date: batch.expiry_date,
          package_count: batch.package_count,
          days_until: days,
        };
        if (days < 0) expired.push(entry);
        else if (days <= soonDays) expiringSoon.push(entry);
      }
      expired.sort((a, b) => a.days_until - b.days_until);
      expiringSoon.sort((a, b) => a.days_until - b.days_until);
      res.json({
        total: products.length,
        product_count: products.length,
        purchase_count: batches.length,
        zero_count: zeroCount,
        expired_count: expired.length,
        expiring_soon_count: expiringSoon.length,
        by_category: byCategory,
        by_location: byLocation,
        by_company: byCompany,
        expired,
        expiring_soon: expiringSoon,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
