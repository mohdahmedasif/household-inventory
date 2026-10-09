import { useEffect, useState } from "react";
import { App as AntdApp, Button, Input, Popconfirm, Tabs } from "antd";
import {
  addCatalogOption,
  deleteCatalogOption,
  fetchCatalog,
  fetchSettings,
  renameCatalogOption,
  type Catalog,
  type CatalogKind,
} from "../api";
import { applySettings } from "../settings";

const TABS: {
  key: CatalogKind;
  label: string;
  singular: string;
  listKey: keyof Pick<Catalog, "categories" | "locations" | "package_types">;
}[] = [
  { key: "category", label: "Categories", singular: "category", listKey: "categories" },
  { key: "location", label: "Locations", singular: "location", listKey: "locations" },
  { key: "package_type", label: "Package types", singular: "package type", listKey: "package_types" },
];

export default function CatalogPage() {
  const { message } = AntdApp.useApp();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [kind, setKind] = useState<CatalogKind>("category");
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setCatalog(await fetchCatalog());
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to load catalog");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const tab = TABS.find((entry) => entry.key === kind)!;
  const options = catalog?.[tab.listKey] ?? [];

  async function onAdd() {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    try {
      setCatalog(await addCatalogOption(kind, name));
      setDraft("");
      message.success("Added");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRename(from: string) {
    const to = renameValue.trim();
    if (!to || to === from) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      setCatalog(await renameCatalogOption(kind, from, to));
      // A renamed option may have been one of the defaults.
      applySettings(await fetchSettings());
      setRenaming(null);
      message.success("Renamed");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(name: string) {
    setBusy(true);
    try {
      setCatalog(await deleteCatalogOption(kind, name));
      message.success("Deleted");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="page-subheading">
        Shared lists for the web UI. Renaming updates every product or batch that uses that value.
      </p>
      <div className="surface-card" style={{ padding: 20 }}>
        <Tabs
          activeKey={kind}
          onChange={(key) => {
            setKind(key as CatalogKind);
            setRenaming(null);
            setDraft("");
          }}
          items={TABS.map((entry) => ({ key: entry.key, label: entry.label }))}
        />
        <div className="page-toolbar flat">
          <Input
            size="large"
            placeholder={`New ${tab.singular}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={() => void onAdd()}
            className="toolbar-search"
          />
          <Button type="primary" size="large" loading={busy} onClick={() => void onAdd()}>
            Add
          </Button>
        </div>
        <div className="catalog-list">
          {options.map((name) => (
            <div key={name} className="catalog-row">
              {renaming === name ? (
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onPressEnter={() => void onRename(name)}
                  style={{ maxWidth: 280 }}
                />
              ) : (
                <strong>{name}</strong>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                {renaming === name ? (
                  <>
                    <Button size="small" type="primary" loading={busy} onClick={() => void onRename(name)}>
                      Save
                    </Button>
                    <Button size="small" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="small"
                      onClick={() => {
                        setRenaming(name);
                        setRenameValue(name);
                      }}
                    >
                      Rename
                    </Button>
                    <Popconfirm
                      title={`Delete "${name}"?`}
                      description="Blocked if any item still uses it."
                      onConfirm={() => void onDelete(name)}
                    >
                      <Button size="small" danger>
                        Delete
                      </Button>
                    </Popconfirm>
                  </>
                )}
              </div>
            </div>
          ))}
          {!options.length ? <p className="import-help">No options yet.</p> : null}
        </div>
      </div>
    </>
  );
}
