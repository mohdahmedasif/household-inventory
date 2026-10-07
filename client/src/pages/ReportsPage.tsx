import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { App as AntdApp, Button, Input, Select, Table } from "antd";
import {
  ClockCircleOutlined,
  DownloadOutlined,
  InboxOutlined,
  PrinterOutlined,
  SearchOutlined,
  ShoppingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { fetchCatalog, fetchReportRows, type Catalog, type ReportRow } from "../api";
import { daysUntil, expiryTone, sizeLabel } from "../format";

type Col = {
  key: string;
  title: string;
  width?: number;
  numeric?: boolean;
  value: (row: ReportRow) => string | number;
  render?: (row: ReportRow) => ReactNode;
};

const COLUMNS: Col[] = [
  { key: "batch_id", title: "ID", width: 64, numeric: true, value: (r) => r.batch_id },
  {
    key: "name",
    title: "Name",
    width: 220,
    value: (r) => r.name,
    render: (r) => <Link to={`/products/${r.product_id}`}>{r.name}</Link>,
  },
  { key: "company", title: "Company", width: 140, value: (r) => r.company },
  { key: "category", title: "Category", width: 150, value: (r) => r.category },
  { key: "location", title: "Location", width: 150, value: (r) => r.location },
  { key: "package_type", title: "Type", width: 100, value: (r) => r.package_type },
  { key: "package_count", title: "Count", width: 72, numeric: true, value: (r) => r.package_count },
  { key: "units_per_package", title: "Units", width: 72, value: (r) => r.units_per_package },
  { key: "size", title: "Size", width: 90, value: (r) => sizeLabel(r) },
  { key: "expiry_date", title: "Expiry", width: 110, value: (r) => r.expiry_date },
  {
    key: "days_left",
    title: "Days left",
    width: 90,
    numeric: true,
    value: (r) => daysUntil(r.expiry_date) ?? "",
  },
  { key: "notes", title: "Notes", width: 180, value: (r) => r.notes },
  { key: "batch_notes", title: "Batch notes", width: 140, value: (r) => r.batch_notes },
  { key: "acquired_on", title: "Acquired", width: 110, value: (r) => r.acquired_on },
];

function csvEscape(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlEscape(value: string | number): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compare(a: string | number, b: string | number): number {
  if (a === "" && b !== "") return 1;
  if (b === "" && a !== "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function downloadCsv(rows: ReportRow[]) {
  const header = COLUMNS.map((c) => csvEscape(c.title)).join(",");
  const body = rows.map((row) => COLUMNS.map((c) => csvEscape(c.value(row))).join(","));
  const csv = "\uFEFF" + [header, ...body].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `inventory-report-${dayjs().format("YYYY-MM-DD")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function printRows(rows: ReportRow[], meta: string) {
  const headers = COLUMNS.map((c) => `<th>${htmlEscape(c.title)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${COLUMNS.map((c) => {
          const cls = c.numeric ? ' class="num"' : "";
          return `<td${cls}>${htmlEscape(c.value(row))}</td>`;
        }).join("")}</tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Household Inventory</title>
  <style>
    @page { size: landscape; margin: 12mm; }
    body { font: 11px/1.35 "Source Sans 3", Segoe UI, sans-serif; color: #111; margin: 0; }
    h1 { font: 600 18px Georgia, serif; margin: 0 0 4px; }
    .meta { color: #555; margin: 0 0 12px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #eee; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
    td.num { text-align: right; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
  </style>
</head>
<body>
  <h1>Household Inventory</h1>
  <p class="meta">${htmlEscape(meta)}</p>
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    document.body.removeChild(frame);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const win = frame.contentWindow;
  if (!win) {
    document.body.removeChild(frame);
    return;
  }

  const cleanup = () => {
    if (frame.parentNode) document.body.removeChild(frame);
  };
  win.addEventListener("afterprint", cleanup);
  win.focus();
  win.print();
  // Fallback if afterprint never fires
  setTimeout(cleanup, 60_000);
}

export default function ReportsPage() {
  const { message } = AntdApp.useApp();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [location, setLocation] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ items }, cat] = await Promise.all([fetchReportRows(), fetchCatalog()]);
        if (cancelled) return;
        setRows(items);
        setCatalog(cat);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (category && row.category !== category) return false;
      if (location && row.location !== location) return false;
      if (!needle) return true;
      return [row.name, row.company, row.category, row.location, row.notes, row.batch_notes]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, category, location]);

  const summary = useMemo(() => {
    let packages = 0;
    let expired = 0;
    let soon = 0;
    for (const row of filtered) {
      packages += row.package_count;
      const tone = expiryTone(row.expiry_date);
      if (tone === "expired") expired += 1;
      if (tone === "soon") soon += 1;
    }
    return { packages, expired, soon };
  }, [filtered]);

  const tableColumns: ColumnsType<ReportRow> = COLUMNS.map((col) => ({
    key: col.key,
    title: col.title,
    width: col.width,
    align: col.numeric ? "right" : "left",
    ellipsis: true,
    sorter: (a, b) => compare(col.value(a), col.value(b)),
    render: (_: unknown, row: ReportRow) => {
      const content = col.render ? col.render(row) : col.value(row);
      if (content === "" || content == null) return <span className="report-blank">—</span>;
      if (col.key === "days_left" && typeof content === "number") {
        const tone = content < 0 ? "expired" : content <= 30 ? "soon" : "ok";
        return <span className={`report-days ${tone}`}>{content}</span>;
      }
      return content;
    },
  }));

  return (
    <>
      <p className="page-subheading">
        Spreadsheet of every purchase batch. Filter, then export or print.
      </p>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-icon">
            <ShoppingOutlined />
          </div>
          <div>
            <div className="label">Rows</div>
            <div className="value">{filtered.length}</div>
          </div>
        </div>
        <div className="stat-tile tone-accent">
          <div className="stat-icon">
            <InboxOutlined />
          </div>
          <div>
            <div className="label">Packages</div>
            <div className="value">{summary.packages}</div>
          </div>
        </div>
        <div className={`stat-tile${summary.soon ? " tone-warn" : ""}`}>
          <div className="stat-icon">
            <ClockCircleOutlined />
          </div>
          <div>
            <div className="label">Expiring soon</div>
            <div className="value">{summary.soon}</div>
          </div>
        </div>
        <div className={`stat-tile${summary.expired ? " tone-danger" : ""}`}>
          <div className="stat-icon">
            <WarningOutlined />
          </div>
          <div>
            <div className="label">Expired</div>
            <div className="value">{summary.expired}</div>
          </div>
        </div>
      </div>

      <div className="page-toolbar">
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined style={{ color: "var(--pantry-faint)" }} />}
          placeholder="Search name, company, notes"
          className="toolbar-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          allowClear
          size="large"
          placeholder="Category"
          className="toolbar-select"
          value={category}
          options={(catalog?.categories ?? []).map((value) => ({ value, label: value }))}
          onChange={setCategory}
        />
        <Select
          allowClear
          size="large"
          placeholder="Location"
          className="toolbar-select"
          value={location}
          options={(catalog?.locations ?? []).map((value) => ({ value, label: value }))}
          onChange={setLocation}
        />
        <div className="toolbar-actions">
          <Button
            icon={<DownloadOutlined />}
            onClick={() => downloadCsv(filtered)}
            disabled={!filtered.length}
          >
            Export CSV
          </Button>
          <Button
            type="primary"
            icon={<PrinterOutlined />}
            onClick={() =>
              printRows(
                filtered,
                `${dayjs().format("D MMM YYYY, HH:mm")} · ${filtered.length} rows · ${summary.packages} packages`,
              )
            }
            disabled={!filtered.length}
          >
            Print
          </Button>
        </div>
      </div>

      <div className="surface-card report-grid">
        <Table
          rowKey="batch_id"
          size="small"
          bordered
          sticky
          loading={loading}
          columns={tableColumns}
          dataSource={filtered}
          scroll={{ x: 1700 }}
          pagination={{
            defaultPageSize: 100,
            showSizeChanger: true,
            pageSizeOptions: [50, 100, 200, 500],
            showTotal: (total) => `${total} rows`,
          }}
        />
      </div>
    </>
  );
}
