// Technical limits and tuning, all in this one place. Everything a household
// would want to change lives on the Settings page instead; the only environment
// variables the app reads are PORT and ADMIN_KEY (see .env.example).

const MB = 1024 * 1024;

export const config = {
  /** Google endpoint used to check a key and list its models. */
  geminiApiBase: "https://generativelanguage.googleapis.com/v1beta",
  geminiTemperature: 0.2,
  /** Waits between retries of the main model, in milliseconds. */
  geminiRetryDelaysMs: [800, 2000],
  /** Largest product photo accepted by Add Product. */
  maxUploadBytes: 8 * MB,
  /** Photos of one product that can be read together. */
  maxPhotos: 6,
  /** Largest backup file accepted by Restore. */
  maxBackupBytes: 50 * MB,
  /** How alike two product names must be (0–1) to be offered as "the same product". */
  similarityThreshold: 0.8,
  similarityAcrossCategories: 0.95,
  similarLimit: 3,
  /** Entries shown in a product's History card. */
  historyLimit: 100,

  // ---------- Access ----------
  pinMinDigits: 4,
  pinMaxDigits: 8,
  /** Wrong PINs allowed in a row before the profile locks. */
  pinFreeAttempts: 5,
  /** Lock length in minutes for the 5th, 6th, 7th and every later wrong PIN. */
  pinLockMinutes: [1, 5, 30, 120],
  /** A device stays paired this long after its last unlock. */
  deviceCookieDays: 365,
  sessionDays: 30,
  pairRateLimit: { limit: 20, windowMs: 5 * 60 * 1000 },
  unlockRateLimit: { limit: 30, windowMs: 5 * 60 * 1000 },
};
