import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { App as AntdApp, Card, Col, Row, Skeleton, Table } from "antd";
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  InboxOutlined,
  ShoppingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { fetchStats, type Stats } from "../api";
import { CHART_COLORS, categoryColor, expiryLabel, expiryTone } from "../format";

type Tone = "default" | "accent" | "warn" | "danger";

function StatTile({ icon, label, value, tone = "default" }: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: Tone;
}) {
  return (
    <div className={`stat-tile${tone === "default" ? "" : ` tone-${tone}`}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="chart-tooltip">
      <strong>{label ?? entry.name}</strong>
      {entry.value}
    </div>
  );
}

const AXIS_TICK = { fontSize: 12, fill: "#78716c" };

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

  const byLocation = useMemo(
    () => [...(stats?.by_location ?? [])].sort((a, b) => b.value - a.value),
    [stats],
  );
  const byCompany = useMemo(
    () =>
      (stats?.by_company ?? [])
        .filter((row) => row.name && row.name !== "Unknown")
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [stats],
  );
  const byCategory = useMemo(
    () => [...(stats?.by_category ?? [])].sort((a, b) => b.value - a.value),
    [stats],
  );

  if (!stats) {
    return (
      <Card className="surface-card">
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  const expiringRows = [...stats.expired, ...stats.expiring_soon];

  return (
    <>
      <p className="page-subheading">Stock levels, shelf life, and where things live.</p>
      <div className="stat-grid">
        <StatTile icon={<AppstoreOutlined />} label="Products" value={stats.product_count ?? stats.total} />
        <StatTile icon={<ShoppingOutlined />} label="Purchases" value={stats.purchase_count ?? 0} tone="accent" />
        <StatTile
          icon={<ClockCircleOutlined />}
          label="Expiring soon"
          value={stats.expiring_soon_count}
          tone={stats.expiring_soon_count ? "warn" : "default"}
        />
        <StatTile
          icon={<WarningOutlined />}
          label="Expired"
          value={stats.expired_count}
          tone={stats.expired_count ? "danger" : "default"}
        />
        <StatTile
          icon={<InboxOutlined />}
          label="Out of stock"
          value={stats.zero_count}
          tone={stats.zero_count ? "warn" : "default"}
        />
      </div>

      <Card title="Expiring soon" className="surface-card stack-gap-below">
        {expiringRows.length === 0 ? (
          <span style={{ color: "var(--pantry-muted)" }}>Nothing expiring in the next 30 days.</span>
        ) : (
          <Table
            rowKey={(row) => `${row.batch_id}-${row.product_id}`}
            size="middle"
            pagination={false}
            scroll={{ x: 560 }}
            dataSource={expiringRows}
            columns={[
              {
                title: "Product",
                dataIndex: "name",
                render: (name: string, row) => (
                  <Link to={`/products/${row.product_id}`} style={{ fontWeight: 600 }}>
                    {name}
                  </Link>
                ),
              },
              { title: "Company", dataIndex: "company", render: (v: string) => v || "—" },
              { title: "Location", dataIndex: "location" },
              { title: "Left", dataIndex: "package_count", width: 70, align: "center" },
              {
                title: "Expiry",
                dataIndex: "expiry_date",
                width: 170,
                render: (value: string) => (
                  <span className={`expiry-pill ${expiryTone(value)}`} title={value}>
                    <ClockCircleOutlined />
                    {expiryLabel(value)}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Row gutter={[18, 18]}>
        <Col xs={24} lg={11}>
          <Card title="By category" className="chart-card surface-card">
            <div className="chart-wrap" style={{ height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    isAnimationActive={false}
                    data={byCategory}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={96}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {byCategory.map((entry) => (
                      <Cell key={entry.name} fill={categoryColor(entry.name)} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="legend-list">
              {byCategory.map((entry) => (
                <span key={entry.name}>
                  <span className="cat-dot" style={{ background: categoryColor(entry.name) }} />
                  {entry.name} · {entry.value}
                </span>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={13}>
          <Card title="By location" className="chart-card surface-card">
            <div className="chart-wrap">
              <ResponsiveContainer>
                <BarChart data={byLocation} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(61,107,79,0.06)" }} />
                  <Bar isAnimationActive={false} dataKey="value" radius={[0, 8, 8, 0]} barSize={22}>
                    {byLocation.map((entry, index) => (
                      <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
      </Row>

      {byCompany.length ? (
        <Card title="Top companies by purchases" className="stack-gap chart-card surface-card">
          <div className="chart-wrap" style={{ height: Math.max(200, byCompany.length * 34) }}>
            <ResponsiveContainer>
              <BarChart data={byCompany} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(61,107,79,0.06)" }} />
                <Bar isAnimationActive={false} dataKey="value" fill="#3d6b4f" radius={[0, 8, 8, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}
    </>
  );
}
