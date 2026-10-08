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

export const DEFAULT_SETTINGS = {
  default_category: "Canned Goods",
  default_location: "Kitchen Cabinet",
  default_package_type: "Pack",
};

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

export const BLANK_PLACEHOLDERS = new Set([
  "",
  "n/a",
  "na",
  "n.a.",
  "none",
  "null",
  "unknown",
  "skip",
  "-",
  "no",
]);

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

const LOWERCASE_UNITS = new Set(["g", "kg", "mg", "ml", "cl", "l", "oz", "lb", "x"]);

/**
 * Capitalize the first letter of each all-lowercase word ("cooking Oil" →
 * "Cooking Oil"). Words with their own casing (iPhone, DS) and units stay as is.
 */
export function titleCase(value) {
  return String(value ?? "").replace(/[\p{L}\p{N}'’]+/gu, (word) => {
    if (LOWERCASE_UNITS.has(word) || word !== word.toLowerCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}
