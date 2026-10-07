import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { App as AntdApp, Button, Input, Segmented, Select, Skeleton } from "antd";
import { ClockCircleOutlined, SearchOutlined, ShoppingOutlined } from "@ant-design/icons";
import {
  fetchCatalog,
  fetchProducts,
  type Catalog,
  type ProductSummary,
} from "../api";
import { categoryColor, daysUntil, expiryLabel, expiryTone } from "../format";

type SortKey = "name" | "expiry" | "stock";

function sortProducts(rows: ProductSummary[], key: SortKey): ProductSummary[] {
  const copy = [...rows];
  if (key === "name") return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (key === "stock") return copy.sort((a, b) => a.on_hand - b.on_hand || a.name.localeCompare(b.name));
  return copy.sort((a, b) => {
    const da = daysUntil(a.next_expiry) ?? Number.POSITIVE_INFINITY;
    const db = daysUntil(b.next_expiry) ?? Number.POSITIVE_INFINITY;
    return da - db || a.name.localeCompare(b.name);
  });
}

export default function ItemsPage() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [allProducts, setAllProducts] = useState<ProductSummary[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [location, setLocation] = useState<string | undefined>();
  const [company, setCompany] = useState("");
  const [sort, setSort] = useState<SortKey>("name");

  const load = async (params = { q, location, company: company || undefined }) => {
    setLoading(true);
    try {
      const [{ products: rows }, cat] = await Promise.all([
        fetchProducts(params),
        catalog ? Promise.resolve(catalog) : fetchCatalog(),
      ]);
      setAllProducts(rows);
      setCatalog(cat);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of allProducts) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [allProducts]);

  const products = useMemo(
    () => sortProducts(category ? allProducts.filter((p) => p.category === category) : allProducts, sort),
    [allProducts, category, sort],
  );

  const filtersActive = Boolean(q || location || company || category);

  return (
    <>
      <p className="page-subheading">
        Everything on the shelf. Each card rolls up every purchase of that product.
      </p>
      <div className="page-toolbar">
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined style={{ color: "var(--pantry-faint)" }} />}
          placeholder="Search name, company, notes"
          className="toolbar-search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) void load({ q: "", location, company: company || undefined });
          }}
          onPressEnter={() => void load()}
        />
        <Select
          allowClear
          size="large"
          placeholder="Any location"
          className="toolbar-select"
          value={location}
          options={(catalog?.locations ?? []).map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setLocation(value);
            void load({ q, location: value, company: company || undefined });
          }}
        />
        <Input
          allowClear
          size="large"
          placeholder="Company"
          className="toolbar-select"
          value={company}
          onChange={(e) => {
            setCompany(e.target.value);
            if (!e.target.value) void load({ q, location, company: undefined });
          }}
          onPressEnter={() => void load()}
        />
        <Segmented<SortKey>
          size="large"
          value={sort}
          onChange={setSort}
          options={[
            { value: "name", label: "A–Z" },
            { value: "expiry", label: "Expiry" },
            { value: "stock", label: "Stock" },
          ]}
        />
        <span className="toolbar-count">
          <strong>{products.length}</strong> product{products.length === 1 ? "" : "s"}
        </span>
      </div>

      {categoryCounts.length > 1 ? (
        <div className="chip-row">
          <button
            type="button"
            className={`filter-chip${category ? "" : " active"}`}
            onClick={() => setCategory(undefined)}
          >
            All <span className="count">{allProducts.length}</span>
          </button>
          {categoryCounts.map(([name, count]) => (
            <button
              key={name}
              type="button"
              className={`filter-chip${category === name ? " active" : ""}`}
              onClick={() => setCategory(category === name ? undefined : name)}
            >
              <span className="cat-dot" style={{ background: categoryColor(name) }} />
              {name} <span className="count">{count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {loading && allProducts.length === 0 ? (
        <div className="item-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton-card">
              <Skeleton active title={{ width: "70%" }} paragraph={{ rows: 3 }} />
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <img src="/logo-mark.svg" alt="" />
          <h2>{filtersActive ? "Nothing matches" : "Your pantry is empty"}</h2>
          <p>
            {filtersActive
              ? "Try a different search or clear the filters."
              : "Add your first product, or bring in an old spreadsheet from the Import page."}
          </p>
          {filtersActive ? (
            <Button
              onClick={() => {
                setQ("");
                setCompany("");
                setLocation(undefined);
                setCategory(undefined);
                void load({ q: "", location: undefined, company: undefined });
              }}
            >
              Clear filters
            </Button>
          ) : (
            <Button type="primary" size="large" onClick={() => navigate("/products/new")}>
              Add first product
            </Button>
          )}
        </div>
      ) : (
        <div className="item-grid">
          {products.map((product) => {
            const tone = expiryTone(product.next_expiry);
            const empty = product.on_hand <= 0;
            return (
              <Link
                key={product.product_id}
                to={`/products/${product.product_id}`}
                className={`item-card tone-${tone}${empty ? " is-empty" : ""}`}
              >
                <div className="item-card-top">
                  <span className="item-card-category">
                    <span className="cat-dot" style={{ background: categoryColor(product.category) }} />
                    <span>{product.category}</span>
                  </span>
                  <span
                    className={`purchase-badge${product.purchase_count > 1 ? " multi" : ""}`}
                    title="Purchases (batches)"
                  >
                    <ShoppingOutlined />
                    {product.purchase_count}
                  </span>
                </div>
                <div>
                  <h2 className="item-card-title">{product.name}</h2>
                  {product.companies.length ? (
                    <div className="item-card-brand">{product.companies.join(" · ")}</div>
                  ) : null}
                </div>
                {product.batch_notes?.length ? (
                  <div className="note-chips">
                    {product.batch_notes.slice(0, 3).map((note) => (
                      <span key={note} className="note-chip" title={note}>
                        {note}
                      </span>
                    ))}
                    {product.batch_notes.length > 3 ? (
                      <span className="note-chip more">+{product.batch_notes.length - 3}</span>
                    ) : null}
                  </div>
                ) : null}
                {product.notes ? <div className="item-card-notes">{product.notes}</div> : null}
                <div className="item-card-footer">
                  <div className="on-hand">
                    <span className="on-hand-value">{product.on_hand}</span>
                    <span className="on-hand-label">on hand</span>
                  </div>
                  <span
                    className={`expiry-pill ${tone}`}
                    title={product.next_expiry ? `Next expiry ${product.next_expiry}` : undefined}
                  >
                    <ClockCircleOutlined />
                    {expiryLabel(product.next_expiry)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
