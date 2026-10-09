import type { Settings } from "./api";

// Settings live in the database. The app loads them once before the first
// screen renders, and the Settings page swaps them after a save.
let current: Settings | null = null;

export function applySettings(next: Settings): void {
  current = next;
  document.title = [next.app_name, next.app_tagline].filter(Boolean).join(" · ");
}

export function settings(): Settings {
  if (!current) throw new Error("Settings were read before they were loaded.");
  return current;
}
