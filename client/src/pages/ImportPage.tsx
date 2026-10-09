import { useMemo, useState } from "react";
import { App as AntdApp, Button, Card, Input, Table, Typography, Upload } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { fetchBackup, fetchSettings, importItems, restoreBackup, type SheetRow } from "../api";
import { applySettings } from "../settings";
import { normalizeProductKey } from "../format";

type DraftRow = SheetRow;

function parseCsv(text: string): DraftRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: DraftRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = cells[i] ?? "";
    });
    if (!Object.values(row).some((value) => value.trim())) continue;
    rows.push({
      item_id: row.item_id ? Number.parseInt(row.item_id, 10) : undefined,
      name: row.name,
      brand: row.brand,
      category: row.category,
      location: row.location,
      package_type: row.package_type,
      package_count: row.package_count
        ? Number.parseInt(row.package_count, 10)
        : undefined,
      units_per_package: row.units_per_package,
      size_value: row.size_value,
      size_unit: row.size_unit,
      expiry_date: row.expiry_date,
      notes: row.notes,
      last_updated: row.last_updated,
      acquired_on: row.acquired_on || row.last_updated,
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parsePayload(raw: string): DraftRow[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text) as { items?: DraftRow[] } | DraftRow[];
    return Array.isArray(parsed) ? parsed : parsed.items ?? [];
  }
  return parseCsv(text);
}

function collapsePreview(rows: DraftRow[]) {
  const map = new Map<
    string,
    { name: string; category: string; purchases: number; companies: Set<string> }
  >();
  for (const row of rows) {
    const name = row.name || "";
    const category = row.category || "";
    const key = normalizeProductKey(name, category);
    let entry = map.get(key);
    if (!entry) {
      entry = { name, category, purchases: 0, companies: new Set() };
      map.set(key, entry);
    }
    entry.purchases += 1;
    const brand = (row.brand || "").trim();
    if (brand) entry.companies.add(brand);
  }
  return [...map.values()].map((entry) => ({
    key: normalizeProductKey(entry.name, entry.category),
    name: entry.name,
    category: entry.category,
    purchases: entry.purchases,
    companies: [...entry.companies].join(", ") || "—",
  }));
}

export default function ImportPage() {
  const { message, modal } = AntdApp.useApp();
  const [backupBusy, setBackupBusy] = useState(false);
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  const collapsed = useMemo(() => collapsePreview(preview), [preview]);
  const multiPurchase = collapsed.filter((row) => row.purchases > 1).length;

  function loadText(text: string) {
    setRaw(text);
    try {
      setPreview(parsePayload(text));
    } catch (err) {
      setPreview([]);
      message.error(err instanceof Error ? err.message : "Could not parse file");
    }
  }

  async function onDownloadBackup() {
    setBackupBusy(true);
    try {
      const backup = await fetchBackup();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `inventory-backup-${backup.exported_at.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      const count = (table: string) => backup.tables[table]?.length ?? 0;
      message.success(`Backup saved: ${count("products")} products, ${count("batches")} purchases`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBackupBusy(false);
    }
  }

  function onRestoreBackup(file: File) {
    modal.confirm({
      title: "Replace everything with this backup?",
      content: `All products, purchases, history, catalog lists and settings currently in the app are replaced by the contents of ${file.name}. This cannot be undone from here.`,
      okText: "Replace everything",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const { restored } = await restoreBackup(file);
          applySettings(await fetchSettings());
          message.success(
            `Restored ${restored.products ?? 0} products and ${restored.batches ?? 0} purchases`,
          );
        } catch (err) {
          message.error(err instanceof Error ? err.message : "Restore failed");
        }
      },
    });
  }

  return (
    <>
      <p className="page-subheading">
        Back up or restore everything, or bring over an old Google Sheets export.
      </p>
      <Card title="Full backup" className="surface-card stack-gap-below">
        <Typography.Paragraph className="import-help">
          One file with everything: products, purchases, history, catalog lists and settings.
          Keep it somewhere other than this computer. Restoring it on a fresh install brings the
          app back exactly as it was when the backup was made.
        </Typography.Paragraph>
        <div className="page-toolbar flat">
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={backupBusy}
            onClick={() => void onDownloadBackup()}
          >
            Download backup
          </Button>
          <Upload
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={(file) => {
              onRestoreBackup(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>Restore from backup…</Button>
          </Upload>
        </div>
      </Card>
      <Card title="Import a spreadsheet" className="surface-card">
      <Typography.Paragraph className="import-help">
        Paste a Google Sheets CSV (with the inventory headers) or a JSON array of
        rows. Same name + category collapse into one product; each row becomes a
        purchase batch. Brand becomes the company on that batch. Existing{" "}
        <code>item_id</code> values are kept as batch ids.
      </Typography.Paragraph>
      <Upload
        accept=".csv,.json,text/csv,application/json"
        showUploadList={false}
        beforeUpload={(file) => {
          void file.text().then(loadText);
          return false;
        }}
      >
        <Button>Choose CSV or JSON file</Button>
      </Upload>
      <Input.TextArea
        className="import-textarea"
        rows={10}
        value={raw}
        placeholder="item_id,name,brand,category,..."
        onChange={(e) => loadText(e.target.value)}
      />
      <Typography.Paragraph className="stack-gap">
        Preview: {preview.length} purchase row(s) → {collapsed.length} product(s)
        {multiPurchase ? ` (${multiPurchase} with multiple purchases)` : ""}
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="key"
        pagination={{ pageSize: 8 }}
        scroll={{ x: 520 }}
        dataSource={collapsed}
        columns={[
          { title: "Product", dataIndex: "name" },
          { title: "Category", dataIndex: "category", width: 160 },
          { title: "Purchases", dataIndex: "purchases", width: 100 },
          { title: "Companies", dataIndex: "companies" },
        ]}
      />
      <Button
        type="primary"
        disabled={!preview.length}
        loading={busy}
        className="stack-gap"
        onClick={async () => {
          setBusy(true);
          try {
            const result = await importItems(preview);
            message.success(
              `Imported ${result.imported} purchases into ${result.products} products` +
                (result.multi_purchase_products
                  ? ` (${result.multi_purchase_products} with multiple purchases)`
                  : ""),
            );
          } catch (err) {
            message.error(err instanceof Error ? err.message : "Import failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        Import into inventory
      </Button>
    </Card>
    </>
  );
}
