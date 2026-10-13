export type Company = {
  company_id: number;
  name: string;
};

export type Batch = {
  batch_id: number;
  product_id: number;
  company_id: number | null;
  company: string;
  location: string;
  package_type: string;
  package_count: number;
  units_per_package: string;
  size_value: string;
  size_unit: string;
  expiry_date: string;
  notes: string;
  acquired_on: string;
  last_updated: string;
};

export type ProductSummary = {
  product_id: number;
  name: string;
  category: string;
  notes: string;
  last_updated: string;
  on_hand: number;
  purchase_count: number;
  companies: string[];
  batch_notes: string[];
  next_expiry: string;
};

export type Product = ProductSummary & {
  batches: Batch[];
};

export type ProductCreateInput = {
  name: string;
  category: string;
  notes?: string;
  company?: string;
  brand?: string;
  location?: string;
  package_type?: string;
  package_count?: number;
  units_per_package?: string;
  size_value?: string;
  size_unit?: string;
  expiry_date?: string;
  acquired_on?: string;
  batch_notes?: string;
};

export type BatchInput = {
  company?: string;
  brand?: string;
  location?: string;
  package_type?: string;
  package_count?: number;
  units_per_package?: string;
  size_value?: string;
  size_unit?: string;
  expiry_date?: string;
  notes?: string;
  acquired_on?: string;
};

/** Legacy flat sheet row used for CSV import. */
export type SheetRow = {
  item_id?: number;
  name?: string;
  brand?: string;
  category?: string;
  location?: string;
  package_type?: string;
  package_count?: number;
  units_per_package?: string;
  size_value?: string;
  size_unit?: string;
  expiry_date?: string;
  notes?: string;
  last_updated?: string;
  acquired_on?: string;
};

export type CatalogKind = "category" | "location" | "package_type" | "size_unit";

export type Catalog = {
  categories: string[];
  locations: string[];
  package_types: string[];
  size_units: string[];
  defaults?: {
    category: string;
    location: string;
    package_type: string;
  };
};

export type Settings = {
  default_category: string;
  default_location: string;
  default_package_type: string;
  expiring_soon_days: number;
  expiry_countdown_days: number;
  top_companies_count: number;
  card_notes_count: number;
  lowercase_units: string[];
  blank_words: string[];
  extract_language: string;
  gemini_model: string;
  gemini_fallback_model: string;
  auto_lock_minutes: number;
  app_name: string;
  app_tagline: string;
};

export type Stats = {
  total: number;
  product_count: number;
  purchase_count: number;
  zero_count: number;
  expired_count: number;
  expiring_soon_count: number;
  by_category: { name: string; value: number }[];
  by_location: { name: string; value: number }[];
  by_company: { name: string; value: number }[];
  expired: Array<{
    batch_id: number;
    product_id: number;
    name: string;
    company: string;
    location: string;
    expiry_date: string;
    package_count: number;
    days_until: number;
  }>;
  expiring_soon: Array<{
    batch_id: number;
    product_id: number;
    name: string;
    company: string;
    location: string;
    expiry_date: string;
    package_count: number;
    days_until: number;
  }>;
};

/** A failed request, with the server's machine-readable code and any extra fields it sent. */
export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = String(data.code ?? "");
    this.data = data;
  }
}

type AccessListener = (state: "unpaired" | "locked") => void;
let accessListener: AccessListener = () => undefined;

/** The app shell listens here to show the pairing or PIN screen when the server asks for one. */
export function onAccessLost(listener: AccessListener): void {
  accessListener = listener;
}

// Access rides on httpOnly cookies, which the browser sends by itself.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new ApiError(String(data?.error ?? `Request failed (${res.status})`), res.status, data ?? {});
    if (res.status === 403 && error.code === "unpaired") accessListener("unpaired");
    if (res.status === 401 && error.code === "locked") accessListener("locked");
    throw error;
  }
  return data as T;
}

// ---------- Access: pairing, profiles, PIN ----------

export type Profile = { profile_id: number; name: string };

export type AccessStatus = {
  paired: boolean;
  profile: Profile | null;
  app_name: string;
  app_tagline: string;
  pin_min: number;
  pin_max: number;
};

const post = (body: unknown = {}) => ({ method: "POST", body: JSON.stringify(body) });

export function fetchAccessStatus() {
  return request<AccessStatus>("/api/auth/status");
}

export function pairDevice(adminKey: string) {
  return request<{ paired: boolean }>("/api/auth/pair", post({ admin_key: adminKey }));
}

export function fetchProfiles() {
  return request<{ profiles: Profile[] }>("/api/profiles");
}

export function createProfile(name: string, pin: string) {
  return request<Profile>("/api/profiles", post({ name, pin }));
}

export function unlockProfile(profileId: number, pin: string) {
  return request<{ profile: Profile }>("/api/auth/unlock", post({ profile_id: profileId, pin }));
}

export function lockSession() {
  return request<{ ok: boolean }>("/api/auth/lock", post());
}

export function resetPin(profileId: number, adminKey: string, pin: string) {
  return request<{ ok: boolean }>(
    `/api/profiles/${profileId}/reset-pin`,
    post({ admin_key: adminKey, pin }),
  );
}

export function changePin(currentPin: string, newPin: string) {
  return request<{ ok: boolean }>(
    "/api/profiles/me/pin",
    post({ current_pin: currentPin, new_pin: newPin }),
  );
}

export function deleteProfile(pin: string) {
  return request<{ ok: boolean }>("/api/profiles/me", {
    method: "DELETE",
    body: JSON.stringify({ pin }),
  });
}

export function unpairDevice() {
  return request<{ ok: boolean }>("/api/auth/unpair", post());
}

export function unpairOtherDevices() {
  return request<{ removed: number }>("/api/auth/unpair-others", post());
}

export function fetchCatalog() {
  return request<Catalog>("/api/catalog");
}

export function addCatalogOption(kind: CatalogKind, name: string) {
  return request<Catalog>(`/api/catalog/${kind}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function renameCatalogOption(kind: CatalogKind, from: string, to: string) {
  return request<Catalog>(`/api/catalog/${kind}`, {
    method: "PATCH",
    body: JSON.stringify({ from, to }),
  });
}

export function deleteCatalogOption(kind: CatalogKind, name: string) {
  const query = new URLSearchParams({ name });
  return request<Catalog>(`/api/catalog/${kind}?${query.toString()}`, {
    method: "DELETE",
  });
}

export function fetchSettings() {
  return request<Settings>("/api/settings");
}

export function updateSettings(body: Partial<Settings>) {
  return request<Settings>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function fetchProducts(
  params: { q?: string; category?: string; location?: string; company?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.category) query.set("category", params.category);
  if (params.location) query.set("location", params.location);
  if (params.company) query.set("company", params.company);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<{ products: ProductSummary[] }>(`/api/products${suffix}`);
}

export function fetchProduct(id: number) {
  return request<Product>(`/api/products/${id}`);
}

export function createProduct(body: ProductCreateInput) {
  return request<Product>("/api/products", { method: "POST", body: JSON.stringify(body) });
}

export function updateProduct(
  id: number,
  body: Partial<Pick<ProductSummary, "name" | "category" | "notes">>,
) {
  return request<Product>(`/api/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export type SimilarProduct = ProductSummary & {
  score: number;
  exact: boolean;
  same_category: boolean;
};

export function fetchSimilarProducts(name: string, category: string) {
  const query = new URLSearchParams({ name, category });
  return request<{ products: SimilarProduct[] }>(`/api/products/similar?${query.toString()}`);
}

export function mergeProduct(sourceId: number, intoId: number) {
  return request<Product>(`/api/products/${sourceId}/merge`, {
    method: "POST",
    body: JSON.stringify({ into: intoId }),
  });
}

export type StockEvent = {
  event_id: number;
  batch_id: number | null;
  kind: "purchase" | "used" | "added" | "removed";
  delta: number;
  count_after: number;
  created_at: string;
  /** The purchase it was about, e.g. "Company · Can 330 g · expires 2028-08-31". */
  detail: string;
  /** The profile that made the change; empty for entries from before profiles existed. */
  actor: string;
  can_undo: boolean;
};

export function undoStockEvent(eventId: number) {
  return request<Product>(`/api/events/${eventId}/undo`, { method: "POST" });
}

export function fetchProductEvents(id: number) {
  return request<{ events: StockEvent[] }>(`/api/products/${id}/events`);
}

export function deleteProduct(id: number) {
  return request<{ ok: boolean; product_id: number }>(`/api/products/${id}`, {
    method: "DELETE",
  });
}

export function addBatch(productId: number, body: BatchInput) {
  return request<Product>(`/api/products/${productId}/batches`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateBatch(batchId: number, body: Partial<BatchInput>) {
  return request<Batch>(`/api/batches/${batchId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function adjustBatchCount(batchId: number, delta: number) {
  return request<Batch>(`/api/batches/${batchId}/count`, {
    method: "POST",
    body: JSON.stringify({ delta }),
  });
}

export function deleteBatch(batchId: number) {
  return request<{ ok: boolean; batch_id: number; product_deleted: boolean }>(
    `/api/batches/${batchId}`,
    { method: "DELETE" },
  );
}

export function fetchCompanies() {
  return request<{ companies: Company[] }>("/api/companies");
}

export function importItems(items: SheetRow[]) {
  return request<{
    imported: number;
    products: number;
    multi_purchase_products: number;
  }>("/api/import", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export type GeminiKey = {
  key_id: number;
  /** Last four characters of the key; the key itself never leaves the server. */
  hint: string;
  created_at: string;
  last_used_at: string;
  last_error: string;
  /** False when the server can no longer decrypt it and it must be entered again. */
  readable: boolean;
};

export type GeminiKeyList = { keys: GeminiKey[] };

export function fetchGeminiKeys() {
  return request<GeminiKeyList>("/api/gemini-keys");
}

export function addGeminiKey(key: string) {
  return request<GeminiKeyList>("/api/gemini-keys", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
}

export function testGeminiKey(keyId: number) {
  return request<GeminiKeyList & { ok: boolean; error: string }>(
    `/api/gemini-keys/${keyId}/test`,
    { method: "POST" },
  );
}

export function deleteGeminiKey(keyId: number) {
  return request<GeminiKeyList>(`/api/gemini-keys/${keyId}`, { method: "DELETE" });
}

export function fetchGeminiModels() {
  return request<{ models: { name: string; label: string }[] }>("/api/gemini-models");
}

export type Backup = {
  format: string;
  version: number;
  exported_at: string;
  tables: Record<string, unknown[]>;
};

export function fetchBackup() {
  return request<Backup>("/api/backup");
}

export function restoreBackup(file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<{ restored: Record<string, number>; exported_at: string }>("/api/restore", {
    method: "POST",
    body,
  });
}

export function fetchStats() {
  return request<Stats>("/api/stats");
}

export type ReportRow = {
  item_id: number;
  batch_id: number;
  product_id: number;
  name: string;
  brand: string;
  company: string;
  category: string;
  location: string;
  package_type: string;
  package_count: number;
  units_per_package: string;
  size_value: string;
  size_unit: string;
  expiry_date: string;
  notes: string;
  batch_notes: string;
  acquired_on: string;
  last_updated: string;
  purchase_count: number;
};

export function fetchReportRows() {
  return request<{ items: ReportRow[] }>("/api/items");
}

export function extractFromImage(file: File, caption = "") {
  const body = new FormData();
  body.append("image", file);
  if (caption.trim()) body.append("caption", caption.trim());
  return request<{ item: ProductCreateInput }>("/api/extract", {
    method: "POST",
    body,
  });
}
