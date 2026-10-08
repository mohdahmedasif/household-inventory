import { GoogleGenAI } from "@google/genai";

const EXTRACTION_SYSTEM_INSTRUCTION = `Extract one household inventory item — a pantry/grocery item OR a medicine/supplement — into a JSON object with keys: name, brand, category, location, package_type, package_count, units_per_package, size_value, size_unit, expiry_date, notes.
name MUST be a real, concrete product or medicine name in English (translate from the user's language or label text if needed). For a branded medicine use the label's product name (e.g. 'Nexpro-20 Tablets'); if only the generic/active ingredient is known, use that (e.g. 'Pantoprazol'). For groceries use the plain English product name (e.g. 'Chickpeas', 'Sella Basmati Rice'). Never use Unknown, N/A, or a placeholder.
brand = manufacturer/company if identifiable from the text or label (e.g. 'Freshona', 'Aristo', 'K-Classic'); else leave blank.
category MUST be exactly one of the allowed categories listed below. Use 'Medicine' for drugs/OTC treatments, 'Supplement' for vitamins/herbal/wellness products when those options exist, and the closest grocery category for food/pantry items — never invent a new category.
location MUST be exactly one of the allowed locations listed below. Default to the kitchen-style location for groceries and washroom-style for medicine/supplements unless the text clearly says otherwise.
package_type MUST be exactly one of the allowed package types listed below (blister packs/strips → 'Tablet Strip' when available; loose pills in a bottle → 'Bottle'; canned food → 'Can'; jarred food → 'Jar'; boxed → 'Box').
package_count = number of packs/strips/cans/bottles on hand (integer, default 1 if not stated).
units_per_package = tablets/capsules/bottles per pack if known (e.g. tablets per strip); else leave blank (never write N/A).
size_value/size_unit = the strength or size split into a plain number and its unit (e.g. '20 mg' -> size_value 20, size_unit mg; '500g' -> size_value 500, size_unit g); leave both blank if unknown.
notes: for medicine/supplement, briefly say what it treats/is used for (symptoms/conditions) — infer from the drug/brand if the label doesn't spell it out; for groceries, leave blank unless there is something notable to record.
expiry_date: convert to YYYY-MM-DD if provided, otherwise leave blank.
Never write 'N/A' anywhere — use an empty string for unknown optional fields.`;

const PLACEHOLDERS = new Set(["", "n/a", "na", "none", "null", "unknown", "-", "—"]);

function blankIfPlaceholder(value) {
  const text = String(value ?? "").trim();
  if (!text || PLACEHOLDERS.has(text.toLowerCase())) return "";
  return text;
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

function coerceExpiry(value) {
  const text = blankIfPlaceholder(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildInstruction(categories, locations, packageTypes) {
  return (
    EXTRACTION_SYSTEM_INSTRUCTION +
    `\nAllowed categories: ${categories.join(", ")}.` +
    `\nAllowed locations: ${locations.join(", ")}.` +
    `\nAllowed package types: ${packageTypes.join(", ")}.`
  );
}

function buildSchema(categories, locations, packageTypes) {
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
      size_unit: { type: "string" },
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
  const categories = catalog.categories?.length ? catalog.categories : ["Canned Goods"];
  const locations = catalog.locations?.length ? catalog.locations : ["Kitchen Cabinet"];
  const packageTypes = catalog.package_types?.length ? catalog.package_types : ["Pack"];
  const defaults = {
    category: settings?.default_category || catalog.defaults?.category || categories[0],
    location: settings?.default_location || catalog.defaults?.location || locations[0],
    package_type:
      settings?.default_package_type || catalog.defaults?.package_type || packageTypes[0],
    package_count: 1,
  };

  let packageCount = Number(raw?.package_count);
  if (!Number.isFinite(packageCount) || packageCount < 0) packageCount = defaults.package_count;

  const units = blankIfPlaceholder(raw?.units_per_package);
  const unitsMatch = units.match(/\d+/);

  return {
    name: blankIfPlaceholder(raw?.name),
    company: blankIfPlaceholder(raw?.brand || raw?.company),
    category: coerceChoice(raw?.category, categories, defaults.category),
    location: coerceChoice(raw?.location, locations, defaults.location),
    package_type: coerceChoice(raw?.package_type, packageTypes, defaults.package_type),
    package_count: Math.max(0, Math.trunc(packageCount)),
    units_per_package: unitsMatch ? unitsMatch[0] : units,
    size_value: blankIfPlaceholder(raw?.size_value),
    size_unit: blankIfPlaceholder(raw?.size_unit),
    expiry_date: coerceExpiry(raw?.expiry_date),
    notes: blankIfPlaceholder(raw?.notes),
    batch_notes: "",
  };
}

function geminiApiKey() {
  return (
    process.env.INVENTORY_GEMINI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    ""
  );
}

function geminiModel() {
  return process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
}

function geminiFallbackModel() {
  return process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-flash-lite-latest";
}

const RETRY_DELAYS_MS = [800, 2000];

function isOverloaded(err) {
  const status = Number(err?.status);
  if (status === 429 || status === 500 || status === 503) return true;
  return /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(String(err?.message || ""));
}

// Gemini sheds load with 503/429 during demand spikes: retry the primary
// model briefly, then try the fallback model once before giving up.
async function generateWithRetry(ai, request) {
  const primary = geminiModel();
  const fallback = geminiFallbackModel();
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await ai.models.generateContent({ ...request, model: primary });
    } catch (err) {
      if (!isOverloaded(err)) throw err;
      lastError = err;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  if (!fallback || fallback === primary) throw lastError;
  console.warn(`Gemini ${primary} unavailable; falling back to ${fallback}.`);
  return ai.models.generateContent({ ...request, model: fallback });
}

export async function extractItem({
  imageBuffer,
  mimeType = "image/jpeg",
  caption = "",
  catalog,
  settings,
}) {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    const err = new Error(
      "Gemini is not configured. Set GEMINI_API_KEY (or INVENTORY_GEMINI_API_KEY) on the server.",
    );
    err.status = 503;
    throw err;
  }
  if (!imageBuffer?.length) {
    const err = new Error("Image is required.");
    err.status = 400;
    throw err;
  }

  const categories = catalog.categories || [];
  const locations = catalog.locations || [];
  const packageTypes = catalog.package_types || [];
  if (!categories.length || !locations.length || !packageTypes.length) {
    const err = new Error("Catalog is empty; add categories, locations, and package types first.");
    err.status = 400;
    throw err;
  }

  const promptBits = ["Extract the household inventory item from the provided input."];
  const captionText = String(caption || "").trim();
  if (captionText) promptBits.push(`User text/caption:\n${captionText}`);
  else promptBits.push("No caption was provided; infer details from the image/label.");

  const ai = new GoogleGenAI({ apiKey });
  const request = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: Buffer.from(imageBuffer).toString("base64"),
            },
          },
          { text: promptBits.join("\n") },
        ],
      },
    ],
    config: {
      systemInstruction: buildInstruction(categories, locations, packageTypes),
      responseMimeType: "application/json",
      responseJsonSchema: buildSchema(categories, locations, packageTypes),
      temperature: 0.2,
    },
  };
  let response;
  try {
    response = await generateWithRetry(ai, request);
  } catch (cause) {
    const err = new Error(cause?.message || "Gemini request failed.");
    err.status = 502;
    err.cause = cause;
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
