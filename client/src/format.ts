import type { Batch, ProductCreateInput, Settings } from "./api";

export function expiryTone(expiry: string): "none" | "ok" | "soon" | "expired" {
  if (!expiry) return "none";
  const days = daysUntil(expiry);
  if (days == null) return "none";
  if (days < 0) return "expired";
  if (days <= 30) return "soon";
  return "ok";
}

export function daysUntil(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const target = Date.parse(`${iso}T00:00:00`);
  if (Number.isNaN(target)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

export function expiryLabel(expiry: string): string {
  if (!expiry) return "No expiry";
  const days = daysUntil(expiry);
  if (days == null) return expiry;
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  if (days <= 60) return `${days}d left`;
  return expiry;
}

export const CHART_COLORS = [
  "#3d6b4f",
  "#6f947c",
  "#c4a574",
  "#5b7c8d",
  "#8fad99",
  "#b45309",
  "#78716c",
  "#4a7d5d",
  "#a78b6d",
  "#2f543d",
];

export function categoryColor(name: string): string {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CHART_COLORS[hash % CHART_COLORS.length];
}

export function emptyProductInput(settings?: Partial<Settings> | null): ProductCreateInput {
  return {
    name: "",
    category: settings?.default_category || "Canned Goods",
    notes: "",
    company: "",
    location: settings?.default_location || "Kitchen Cabinet",
    package_type: settings?.default_package_type || "Pack",
    package_count: 1,
    units_per_package: "",
    size_value: "",
    size_unit: "",
    expiry_date: "",
    batch_notes: "",
  };
}

export const BATCH_NOTE_SUGGESTIONS = [
  "Whole",
  "Sliced",
  "Chopped",
  "Diced",
  "Crushed",
  "Baked",
  "Organic",
  "Low salt",
  "No added sugar",
];

export function emptyBatchInput(settings?: Partial<Settings> | null) {
  return {
    company: "",
    location: settings?.default_location || "Kitchen Cabinet",
    package_type: settings?.default_package_type || "Pack",
    package_count: 1,
    units_per_package: "",
    size_value: "",
    size_unit: "",
    expiry_date: "",
    notes: "",
    acquired_on: "",
  };
}

export function sizeLabel(
  item: Pick<Batch, "size_value" | "size_unit"> | { size_value?: string; size_unit?: string },
): string {
  return [item.size_value, item.size_unit].filter(Boolean).join(" ");
}

export function normalizeProductKey(name: string, category: string): string {
  return `${String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")}::${String(category ?? "")
    .trim()
    .toLowerCase()}`;
}
