// Technical limits and tuning, all in this one place. Everything a household
// would want to change lives on the Settings page instead; the only environment
// variables the app reads are PORT and KEY (see .env.example).

const MB = 1024 * 1024;

export const config = {
  /** Google endpoint used to check a key and list its models. */
  geminiApiBase: "https://generativelanguage.googleapis.com/v1beta",
  geminiTemperature: 0.2,
  /** Waits between retries of the main model, in milliseconds. */
  geminiRetryDelaysMs: [800, 2000],
  /** Largest product photo accepted by Add Product. */
  maxUploadBytes: 8 * MB,
  /** Largest backup file accepted by Restore. */
  maxBackupBytes: 50 * MB,
  /** How alike two product names must be (0–1) to be offered as "the same product". */
  similarityThreshold: 0.8,
  similarityAcrossCategories: 0.95,
  similarLimit: 3,
  /** Entries shown in a product's History card. */
  historyLimit: 100,
};
