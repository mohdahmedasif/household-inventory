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

export type CatalogKind = "category" | "location" | "package_type";

export type Catalog = {
  categories: string[];
  locations: string[];
  package_types: string[];
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

export class AuthError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AuthError";
  }
}

const KEY_STORAGE = "inventory.apiKey";

export function getApiKey(): string {
  return sessionStorage.getItem(KEY_STORAGE) || "";
}

export function setApiKey(key: string): void {
  if (key) sessionStorage.setItem(KEY_STORAGE, key);
  else sessionStorage.removeItem(KEY_STORAGE);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const key = getApiKey();
  if (key) headers.set("Authorization", `Bearer ${key}`);

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new AuthError();
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function fetchAuthStatus() {
  return request<{ required: boolean; app_name: string; app_tagline: string }>("/api/auth");
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
};

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
