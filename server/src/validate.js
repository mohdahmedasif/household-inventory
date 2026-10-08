import { BLANK_PLACEHOLDERS, WRITABLE_FIELDS, sentenceCase, titleCase } from "./catalog.js";
import { getCatalog, getSettings } from "./db.js";

const SHEETS_EPOCH = Date.UTC(1899, 11, 30);

export function blankIfPlaceholder(value) {
  const text = String(value ?? "").trim();
  if (!text || BLANK_PLACEHOLDERS.has(text.toLowerCase())) return "";
  return text;
}

export function coerceChoice(value, allowed, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const list = allowed?.length ? allowed : [fallback].filter(Boolean);
  const lowered = new Map(list.map((opt) => [opt.toLowerCase(), opt]));
  if (lowered.has(text.toLowerCase())) return lowered.get(text.toLowerCase());
  const folded = text.toLowerCase();
  for (const opt of list) {
    const optFolded = opt.toLowerCase();
    if (optFolded.includes(folded) || folded.includes(optFolded)) return opt;
  }
  return fallback || text;
}

export function coerceDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && value > 20000 && value < 80000) {
    return new Date(SHEETS_EPOCH + value * 86400000).toISOString().slice(0, 10);
  }
  let text = String(value).trim();
  if (text.startsWith("'")) text = text.slice(1);
  if (/^\d+$/.test(text)) {
    const num = Number(text);
    if (num > 20000 && num < 80000) {
      return new Date(SHEETS_EPOCH + num * 86400000).toISOString().slice(0, 10);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  return text;
}

export function coercePackageCount(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(0, parsed);
}

export function normalizeProduct(db, raw = {}, { partial = false } = {}) {
  const catalog = getCatalog(db);
  const settings = getSettings(db);
  const out = {};
  const source = raw && typeof raw === "object" ? raw : {};

  const take = (field, transform) => {
    if (partial && source[field] === undefined) return;
    out[field] = transform(source[field]);
  };

  take("name", (v) => titleCase(blankIfPlaceholder(v)));
  take("category", (v) =>
    coerceChoice(v, catalog.categories, settings.default_category),
  );
  take("notes", (v) => sentenceCase(blankIfPlaceholder(v)));

  if (!partial && !out.name) {
    const err = new Error("Name is required.");
    err.status = 400;
    throw err;
  }
  if (partial && source.name !== undefined && !out.name) {
    const err = new Error("Name is required.");
    err.status = 400;
    throw err;
  }
  return out;
}

export function normalizeBatch(db, raw = {}, { partial = false } = {}) {
  const catalog = getCatalog(db);
  const settings = getSettings(db);
  const out = {};
  const source = raw && typeof raw === "object" ? raw : {};

  const take = (field, transform) => {
    if (partial && source[field] === undefined) return;
    out[field] = transform(source[field]);
  };

  // brand / company are aliases for the company name
  if (!partial || source.company !== undefined || source.brand !== undefined) {
    const companyRaw =
      source.company !== undefined ? source.company : source.brand;
    out.company = titleCase(blankIfPlaceholder(companyRaw));
  }

  take("location", (v) =>
    coerceChoice(v, catalog.locations, settings.default_location),
  );
  take("package_type", (v) =>
    coerceChoice(v, catalog.package_types, settings.default_package_type),
  );
  take("package_count", (v) => coercePackageCount(v, partial ? 0 : 1));
  take("units_per_package", (v) => blankIfPlaceholder(v));
  take("size_value", (v) => blankIfPlaceholder(v));
  take("size_unit", (v) => blankIfPlaceholder(v));
  take("expiry_date", (v) => coerceDate(v));
  take("notes", (v) => sentenceCase(blankIfPlaceholder(v)));
  if (!partial || source.acquired_on !== undefined || source.last_updated !== undefined) {
    const stamp = source.acquired_on !== undefined ? source.acquired_on : source.last_updated;
    out.acquired_on = coerceDate(stamp) || "";
  }

  return out;
}

/**
 * Combined product+batch bodies use `notes` for the product and `batch_notes`
 * for the purchase (e.g. "sliced", "baked").
 */
export function batchFieldsSource(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return { ...source, notes: source.batch_notes };
}

/** Normalize a sheet-style flat row into product + batch fields. */
export function normalizeSheetRow(db, raw = {}) {
  const product = normalizeProduct(db, raw);
  const batch = normalizeBatch(db, raw);
  return { product, batch };
}

export function parseId(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export const parseItemId = parseId;
export const parseProductId = parseId;
export const parseBatchId = parseId;

export { WRITABLE_FIELDS };
