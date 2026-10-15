import { GoogleGenAI } from "@google/genai";
import { sentenceCase, titleCase } from "./catalog.js";
import { config } from "./config.js";
import { blankIfPlaceholder } from "./validate.js";

// The lists, defaults and language all come from the database, so the prompt
// never names a particular category, location, package type or brand.
function buildInstruction(categories, locations, packageTypes, sizeUnits, settings) {
  return [
    "Extract one household inventory item (food, drink, medicine, supplement or household supply) into a JSON object with keys: name, brand, category, location, package_type, package_count, units_per_package, size_value, size_unit, expiry_date, notes.",
    `name MUST be a real, concrete product name in ${settings.extract_language} (translate from the label or the user's text if needed). Use the product name printed on the label; if only a generic name or active ingredient is known, use that. Never use a placeholder.`,
    "brand = the manufacturer or company if it can be identified from the text or label; otherwise leave blank.",
    `category MUST be exactly one of the allowed categories. Pick the closest match and never invent a new one; if nothing fits, use "${settings.default_category}".`,
    `location MUST be exactly one of the allowed locations. Pick the most plausible place for this kind of item unless the text says where it is kept; if unsure, use "${settings.default_location}".`,
    `package_type MUST be exactly one of the allowed package types. Pick the one that best describes the packaging; if unsure, use "${settings.default_package_type}".`,
    "package_count = number of packages on hand (integer, 1 if not stated).",
    "units_per_package = pieces per package if known (for example tablets per strip); otherwise leave blank.",
    "size_value/size_unit = the strength or size split into a plain number and its unit; size_unit MUST be one of the allowed units, converting if the label uses another spelling; leave both blank if unknown.",
    "notes: for a medicine or supplement, briefly say what it is used for, inferring from the product if the label does not say; for anything else leave blank unless there is something notable to record.",
    "expiry_date: convert to YYYY-MM-DD if provided, otherwise leave blank.",
    "Use an empty string for any unknown optional field.",
    `Allowed categories: ${categories.join(", ")}.`,
    `Allowed locations: ${locations.join(", ")}.`,
    `Allowed package types: ${packageTypes.join(", ")}.`,
    `Allowed units: ${sizeUnits.join(", ")}.`,
  ].join("\n");
}

function coerceChoice(value, allowed, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const exact = allowed.find((item) => item === text);
  if (exact) return exact;
  const lower = text.toLowerCase();
  const ci = allowed.find((item) => item.toLowerCase() === lower);
  if (ci) return ci;
  return fallback || allowed[0] || "";
}

function coerceExpiry(value, blankWords) {
  const text = blankIfPlaceholder(value, blankWords);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildSchema(categories, locations, packageTypes, sizeUnits) {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      brand: { type: "string" },
      category: { type: "string", enum: categories },
      location: { type: "string", enum: locations },
      package_type: { type: "string", enum: packageTypes },
      package_count: { type: "integer" },
      units_per_package: { type: "string" },
      size_value: { type: "string" },
      size_unit: { type: "string", enum: [...sizeUnits, ""] },
      expiry_date: { type: "string" },
      notes: { type: "string" },
    },
    required: [
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
    ],
  };
}

function normalizeDraft(raw, catalog, settings) {
  const blank = (value) => blankIfPlaceholder(value, settings.blank_words);

  let packageCount = Number(raw?.package_count);
  if (!Number.isFinite(packageCount) || packageCount < 0) packageCount = 1;

  const units = blank(raw?.units_per_package);
  const unitsMatch = units.match(/\d+/);

  return {
    name: titleCase(blank(raw?.name), settings.lowercase_units),
    company: titleCase(blank(raw?.brand || raw?.company), settings.lowercase_units),
    category: coerceChoice(raw?.category, catalog.categories, settings.default_category),
    location: coerceChoice(raw?.location, catalog.locations, settings.default_location),
    package_type: coerceChoice(
      raw?.package_type,
      catalog.package_types,
      settings.default_package_type,
    ),
    package_count: Math.max(0, Math.trunc(packageCount)),
    units_per_package: unitsMatch ? unitsMatch[0] : units,
    size_value: blank(raw?.size_value),
    size_unit:
      (catalog.size_units || []).find(
        (unit) => unit.toLowerCase() === blank(raw?.size_unit).toLowerCase(),
      ) ?? "",
    expiry_date: coerceExpiry(raw?.expiry_date, settings.blank_words),
    notes: sentenceCase(blank(raw?.notes)),
    batch_notes: "",
  };
}

function isOverloaded(err) {
  const status = Number(err?.status);
  if (status === 429 || status === 500 || status === 503) return true;
  return /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(String(err?.message || ""));
}

// Gemini sheds load with 503/429 during demand spikes: retry the primary
// model briefly, then try the fallback model once before giving up.
async function generateWithRetry(ai, request, primary, fallback) {
  const delays = config.geminiRetryDelaysMs;
  let lastError;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await ai.models.generateContent({ ...request, model: primary });
    } catch (err) {
      if (!isOverloaded(err)) throw err;
      lastError = err;
      const delay = delays[attempt];
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  if (!fallback || fallback === primary) throw lastError;
  console.warn(`Gemini ${primary} unavailable; falling back to ${fallback}.`);
  return ai.models.generateContent({ ...request, model: fallback });
}

// A key Google rejects or has rate-limited; the next key is worth trying.
function isKeyProblem(err) {
  const status = Number(err?.status);
  if (status === 401 || status === 403 || status === 429) return true;
  return /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|RESOURCE_EXHAUSTED|quota/i.test(
    String(err?.message || ""),
  );
}

/** Ask Google whether a key works. Resolves to "" when it does, or a short reason. */
export async function checkGeminiKey(key) {
  try {
    const res = await fetch(`${config.geminiApiBase}/models?pageSize=1`, {
      headers: { "x-goog-api-key": key },
    });
    if (res.ok) return "";
    const body = await res.json().catch(() => null);
    return body?.error?.message || `Google answered ${res.status}.`;
  } catch (err) {
    return `Could not reach Google: ${err?.message || "network error"}`;
  }
}

/** Models this key can use for reading photos, as [{ name, label }]. */
export async function listGeminiModels(key) {
  const res = await fetch(`${config.geminiApiBase}/models?pageSize=1000`, {
    headers: { "x-goog-api-key": key },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || `Google answered ${res.status}.`);
  return (body?.models ?? [])
    .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((model) => ({
      name: String(model.name ?? "").replace(/^models\//, ""),
      label: model.displayName || "",
    }))
    .filter((model) => model.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `apiKeys` is tried in order: [{ key, key_id }]. `onKeyResult(key_id, error)`
 * is told how each saved key did.
 */
export async function extractItem({
  images = [],
  caption = "",
  catalog,
  settings,
  apiKeys = [],
  onKeyResult = () => {},
}) {
  if (!apiKeys.length) {
    const err = new Error("Gemini is not configured. Add an API key in Settings.");
    err.status = 503;
    throw err;
  }
  if (!images.length || images.some((image) => !image.buffer?.length)) {
    const err = new Error("Add at least one photo.");
    err.status = 400;
    throw err;
  }

  const categories = catalog.categories || [];
  const locations = catalog.locations || [];
  const packageTypes = catalog.package_types || [];
  const sizeUnits = catalog.size_units || [];
  if (!categories.length || !locations.length || !packageTypes.length) {
    const err = new Error("Catalog is empty; add categories, locations, and package types first.");
    err.status = 400;
    throw err;
  }

  const promptBits = [
    images.length > 1
      ? `These ${images.length} photos all show the same single product from different sides (front, back, label, expiry date). Combine what they show into one item.`
      : "Extract the household inventory item from the provided input.",
  ];
  const captionText = String(caption || "").trim();
  if (captionText) promptBits.push(`User text/caption:\n${captionText}`);
  else promptBits.push("No caption was provided; infer details from the image/label.");

  const request = {
    contents: [
      {
        role: "user",
        parts: [
          ...images.map((image) => ({
            inlineData: {
              mimeType: image.mimeType || "image/jpeg",
              data: Buffer.from(image.buffer).toString("base64"),
            },
          })),
          { text: promptBits.join("\n") },
        ],
      },
    ],
    config: {
      systemInstruction: buildInstruction(categories, locations, packageTypes, sizeUnits, settings),
      responseMimeType: "application/json",
      responseJsonSchema: buildSchema(categories, locations, packageTypes, sizeUnits),
      temperature: config.geminiTemperature,
    },
  };
  let response;
  let failure;
  for (const entry of apiKeys) {
    try {
      response = await generateWithRetry(
        new GoogleGenAI({ apiKey: entry.key }),
        request,
        settings.gemini_model,
        settings.gemini_fallback_model,
      );
      if (entry.key_id) onKeyResult(entry.key_id, "");
      break;
    } catch (cause) {
      failure = cause;
      if (entry.key_id) onKeyResult(entry.key_id, cause?.message || "Request failed");
      if (!isKeyProblem(cause)) break;
    }
  }
  if (!response) {
    const err = new Error(failure?.message || "Gemini request failed.");
    err.status = 502;
    err.cause = failure;
    throw err;
  }

  const text = response?.text;
  if (!text) {
    const err = new Error("Gemini returned an empty response.");
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error("Gemini returned invalid JSON.");
    err.status = 502;
    throw err;
  }
  if (Array.isArray(parsed)) parsed = parsed[0];
  if (!parsed || typeof parsed !== "object") {
    const err = new Error("Gemini JSON was not an object.");
    err.status = 502;
    throw err;
  }

  const item = normalizeDraft(parsed, catalog, settings);
  if (!item.name) {
    const err = new Error("Could not read a product name from that photo. Try a clearer label.");
    err.status = 422;
    throw err;
  }
  return item;
}

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
