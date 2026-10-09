import type { Batch, ProductCreateInput } from "./api";
import { settings } from "./settings";
import { chartColor } from "./theme";

export function expiryTone(expiry: string): "none" | "ok" | "soon" | "expired" {
  if (!expiry) return "none";
  const days = daysUntil(expiry);
  if (days == null) return "none";
  if (days < 0) return "expired";
  if (days <= settings().expiring_soon_days) return "soon";
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
  if (days <= settings().expiry_countdown_days) return `${days}d left`;
  return expiry;
}

export function categoryColor(name: string): string {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return chartColor(hash);
}

export function emptyProductInput(): ProductCreateInput {
  const defaults = settings();
  return {
    name: "",
    category: defaults.default_category,
    notes: "",
    company: "",
    location: defaults.default_location,
    package_type: defaults.default_package_type,
    package_count: 1,
    units_per_package: "",
    size_value: "",
    size_unit: "",
    expiry_date: "",
    batch_notes: "",
  };
}

export function emptyBatchInput() {
  const defaults = settings();
  return {
    company: "",
    location: defaults.default_location,
    package_type: defaults.default_package_type,
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
