// Technical knobs, read from the environment (see .env.example). The numbers
// here are only what applies when a variable is not set.

function number(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && String(process.env[name] ?? "").trim() !== "" ? parsed : fallback;
}

function text(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  get geminiApiKey() {
    return text("INVENTORY_GEMINI_API_KEY", "") || text("GEMINI_API_KEY", "");
  },
  get geminiModel() {
    return text("GEMINI_MODEL", "gemini-flash-latest");
  },
  get geminiFallbackModel() {
    return text("GEMINI_FALLBACK_MODEL", "gemini-flash-lite-latest");
  },
  get geminiTemperature() {
    return number("GEMINI_TEMPERATURE", 0.2);
  },
  /** Waits between retries of the main model, in milliseconds. */
  get geminiRetryDelaysMs() {
    return text("GEMINI_RETRY_DELAYS_MS", "800,2000")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((ms) => Number.isFinite(ms) && ms >= 0);
  },
  get maxUploadBytes() {
    return number("INVENTORY_MAX_UPLOAD_MB", 8) * 1024 * 1024;
  },
  /** How alike two product names must be (0–1) to be offered as "the same product". */
  get similarityThreshold() {
    return number("INVENTORY_SIMILARITY", 0.8);
  },
  get similarityAcrossCategories() {
    return number("INVENTORY_SIMILARITY_OTHER_CATEGORY", 0.95);
  },
  get similarLimit() {
    return number("INVENTORY_SIMILAR_LIMIT", 3);
  },
  get maxBackupBytes() {
    return number("INVENTORY_MAX_BACKUP_MB", 50) * 1024 * 1024;
  },
  get historyLimit() {
    return number("INVENTORY_HISTORY_LIMIT", 100);
  },
};
