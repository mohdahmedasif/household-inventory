import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { App as AntdApp, Card, Skeleton } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { fetchStats, type Stats } from "../api";
import { categoryColor, expiryLabel, expiryTone } from "../format";

type Tone = "default" | "accent" | "warn" | "danger";
type CountRow = { name: string; value: number };

function Kpi({ label, value, caption, tone = "default" }: {
  label: string;
  value: number;
  caption: string;
  tone?: Tone;
}) {
  return (
    <div className={`kpi tone-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-caption">{caption}</div>
    </div>
  );
}

/** Ranked rows with a proportional bar: quieter than a chart for a handful of values. */
function BarList({ rows, color, empty }: {
  rows: CountRow[];
  color?: (name: string) => string;
  empty: string;
}) {
  if (!rows.length) return <p className="overview-empty">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="bar-list">
      {rows.map((row) => (
        <li key={row.name}>
          <div className="bar-list-head">
            <span className="bar-list-name">{row.name}</span>
            <span className="bar-list-value">{row.value}</span>
          </div>
          <div className="bar-list-track">
            <span
              style={{
                width: `${Math.max(4, (row.value / max) * 100)}%`,
                background: color ? color(row.name) : undefined,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const byValue = (a: CountRow, b: CountRow) => b.value - a.value || a.name.localeCompare(b.name);

export default function StatsPage() {
  const { message } = AntdApp.useApp();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchStats();
        if (!cancelled) setStats(data);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Failed to load stats");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const byCategory = useMemo(() => [...(stats?.by_category ?? [])].sort(byValue), [stats]);
  const byLocation = useMemo(() => [...(stats?.by_location ?? [])].sort(byValue), [stats]);
  const byCompany = useMemo(
    () =>
      (stats?.by_company ?? [])
        .filter((row) => row.name && row.name !== "Unknown")
        .sort(byValue)
        .slice(0, 8),
    [stats],
  );

  if (!stats) {
    return (
      <Card className="surface-card">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  const attention = [...stats.expired, ...stats.expiring_soon];

  return (
    <>
      <p className="page-subheading">Stock levels, shelf life, and where things live.</p>

      <div className="kpi-grid">
        <Kpi
          label="Products"
          value={stats.product_count ?? stats.total}
          caption={`In ${byCategory.length} categories`}
          tone="accent"
        />
        <Kpi
          label="Purchases"
          value={stats.purchase_count ?? 0}
          caption={`Across ${byLocation.length} locations`}
        />
        <Kpi
          label="Expiring soon"
          value={stats.expiring_soon_count}
          caption="Within the next 30 days"
          tone={stats.expiring_soon_count ? "warn" : "default"}
        />
        <Kpi
          label="Expired"
          value={stats.expired_count}
          caption={stats.expired_count ? "Past their date" : "Nothing past its date"}
          tone={stats.expired_count ? "danger" : "default"}
        />
        <Kpi
          label="Out of stock"
          value={stats.zero_count}
          caption={stats.zero_count ? "Batches at zero" : "Everything in stock"}
          tone={stats.zero_count ? "warn" : "default"}
        />
      </div>

      <div className="overview-grid">
        <div className="overview-col">
        <Card
          title="Needs attention"
          extra={attention.length ? <span className="overview-count">{attention.length}</span> : null}
          className="surface-card"
        >
          {attention.length === 0 ? (
            <div className="overview-clear">
              <CheckCircleOutlined />
              <span>Nothing expired, and nothing expiring in the next 30 days.</span>
            </div>
          ) : (
            <ul className="attention-list">
              {attention.map((row) => (
                <li key={row.batch_id}>
                  <Link to={`/products/${row.product_id}`}>
                    <span className="attention-text">
                      <strong>{row.name}</strong>
                      <span>
                        {[row.company, row.location].filter(Boolean).join(" · ")}
                        {` · ${row.package_count} left`}
                      </span>
                    </span>
                    <span className={`expiry-pill ${expiryTone(row.expiry_date)}`} title={row.expiry_date}>
                      <ClockCircleOutlined />
                      {expiryLabel(row.expiry_date)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="overview-pair">
          <Card title="Purchases by location" className="surface-card">
            <BarList rows={byLocation} empty="No purchases yet." />
          </Card>
          <Card title="Top companies" className="surface-card">
            <BarList rows={byCompany} empty="No companies recorded yet." />
          </Card>
        </div>
        </div>

        <Card title="Products by category" className="surface-card">
          <BarList rows={byCategory} color={categoryColor} empty="No products yet." />
        </Card>
      </div>
    </>
  );
}
