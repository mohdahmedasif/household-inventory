export const CATEGORIES = [
  "Grains & Rice",
  "Canned Goods",
  "Pasta & Noodles",
  "Seasonings & Spices",
  "Beverages",
  "Medicine",
  "Supplement",
];

export const STORAGE_LOCATIONS = [
  "Sofa Storage",
  "Kitchen Cabinet",
  "Basement",
  "Washroom Cabinet",
];

export const PACKAGE_TYPES = [
  "Tablet Strip",
  "Bottle",
  "Flask",
  "Box",
  "Sachet",
  "Jar",
  "Can",
  "Pack",
  "Loose",
];

export const CATALOG_KINDS = {
  category: "category",
  location: "location",
  package_type: "package_type",
};

export const KIND_TO_ITEM_FIELD = {
  category: "category",
  location: "location",
  package_type: "package_type",
};

export const DEFAULT_SEEDS = {
  category: CATEGORIES,
  location: STORAGE_LOCATIONS,
  package_type: PACKAGE_TYPES,
};

// Every setting the app reads, with the value a brand-new database starts with.
// All of them are stored in the database and edited on the Settings page; the
// rest of the code only ever reads them through getSettings().
export const SETTINGS_SCHEMA = {
  default_category: { type: "choice", kind: "category", initial: CATEGORIES[1] },
  default_location: { type: "choice", kind: "location", initial: STORAGE_LOCATIONS[1] },
  default_package_type: { type: "choice", kind: "package_type", initial: PACKAGE_TYPES[7] },
  expiring_soon_days: { type: "int", min: 1, max: 365, initial: 30 },
  expiry_countdown_days: { type: "int", min: 0, max: 730, initial: 60 },
  top_companies_count: { type: "int", min: 1, max: 50, initial: 8 },
  card_notes_count: { type: "int", min: 0, max: 10, initial: 3 },
  lowercase_units: {
    type: "list",
    initial: ["g", "kg", "mg", "ml", "cl", "l", "oz", "lb", "x"],
  },
  blank_words: {
    type: "list",
    initial: ["n/a", "na", "n.a.", "none", "null", "unknown", "skip", "-", "—", "no"],
  },
  extract_language: { type: "text", initial: "English" },
  app_name: { type: "text", initial: "Stocked" },
  app_tagline: { type: "text", initial: "Household inventory" },
};

/** Turn a stored or submitted value into the setting's type; null when invalid. */
export function coerceSetting(spec, value) {
  if (spec.type === "int") {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (Number.isNaN(parsed)) return null;
    return Math.min(spec.max, Math.max(spec.min, parsed));
  }
  if (spec.type === "list") {
    let items = value;
    if (typeof value === "string") {
      try {
        items = JSON.parse(value);
      } catch {
        items = value.split(",");
      }
    }
    if (!Array.isArray(items)) return null;
    return [...new Set(items.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
  }
  const text = String(value ?? "").trim();
  return text || null;
}

export const ITEM_FIELDS = [
  "item_id",
  "name",
  "brand",
  "category",
  "location",
  "package_type",
  "package_count",
  "units_per_package",
  "size_value",
  "size_unit",
  "expiry_date",
  "notes",
  "last_updated",
];

export const WRITABLE_FIELDS = ITEM_FIELDS.filter(
  (field) => field !== "item_id" && field !== "last_updated",
);

export function parseKind(raw) {
  const kind = String(raw || "").trim();
  if (kind in CATALOG_KINDS) return kind;
  return null;
}

/** Capitalize only the first letter, for free-text notes ("walnut" → "Walnut"). */
export function sentenceCase(value) {
  const text = String(value ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Capitalize the first letter of each all-lowercase word ("cooking Oil" →
 * "Cooking Oil"). Words with their own casing (iPhone, DS) and the units listed
 * in the lowercase_units setting stay as is.
 */
export function titleCase(value, lowercaseUnits = []) {
  return String(value ?? "").replace(/[\p{L}\p{N}'’]+/gu, (word) => {
    if (lowercaseUnits.includes(word) || word !== word.toLowerCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}
