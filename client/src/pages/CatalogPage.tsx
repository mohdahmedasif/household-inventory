import { useEffect, useState } from "react";
import { App as AntdApp, Button, Input, Popconfirm, Tabs } from "antd";
import {
  addCatalogOption,
  deleteCatalogOption,
  fetchCatalog,
  fetchSettings,
  renameCatalogOption,
  updateSettings,
  type Catalog,
  type CatalogKind,
  type Settings,
} from "../api";
import { applySettings, settings } from "../settings";

type ListSetting = "lowercase_units" | "blank_words";
type CatalogList = keyof Pick<Catalog, "categories" | "locations" | "package_types" | "size_units">;

// Catalog lists are the options offered in dropdowns; text rules are word lists
// applied when something is saved. Both are edited the same way here.
type Tab = { key: string; label: string; singular: string; help: string } & (
  | { kind: CatalogKind; listKey: CatalogList }
  | { setting: ListSetting }
);

const TABS: Tab[] = [
  {
    key: "category",
    kind: "category",
    listKey: "categories",
    label: "Categories",
    singular: "category",
    help: "The groups products are filed under.",
  },
  {
    key: "location",
    kind: "location",
    listKey: "locations",
    label: "Locations",
    singular: "location",
    help: "The places in your home where things are kept.",
  },
  {
    key: "package_type",
    kind: "package_type",
    listKey: "package_types",
    label: "Package types",
    singular: "package type",
    help: "How a purchase is packaged.",
  },
  {
    key: "size_unit",
    kind: "size_unit",
    listKey: "size_units",
    label: "Units",
    singular: "unit",
    help: "The units offered next to Size on a purchase.",
  },
  {
    key: "lowercase_units",
    setting: "lowercase_units",
    label: "Lowercase words",
    singular: "word",
    help: "Names are capitalized word by word, except these: “Rice 500 g” keeps its small “g”.",
  },
  {
    key: "blank_words",
    setting: "blank_words",
    label: "Empty words",
    singular: "word",
    help: "A field containing only one of these is saved as blank, so “n/a” or “unknown” never ends up as a company or a note.",
  },
];

export default function CatalogPage() {
  const { message } = AntdApp.useApp();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [prefs, setPrefs] = useState<Settings>(settings());
  const [tabKey, setTabKey] = useState(TABS[0].key);
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

  const tab = TABS.find((entry) => entry.key === tabKey)!;
  const isSetting = "setting" in tab;
  const options = "setting" in tab ? prefs[tab.setting] : (catalog?.[tab.listKey] ?? []);

  async function saveWords(key: ListSetting, words: string[]) {
    const next = await updateSettings({ [key]: words });
    applySettings(next);
    setPrefs(next);
  }

  async function run(action: () => Promise<void>, done: string, failed: string) {
    setBusy(true);
    try {
      await action();
      message.success(done);
    } catch (err) {
      message.error(err instanceof Error ? err.message : failed);
    } finally {
      setBusy(false);
    }
  }

  async function onAdd() {
    const name = draft.trim();
    if (!name) return;
    await run(
      async () => {
        if ("setting" in tab) await saveWords(tab.setting, [...prefs[tab.setting], name]);
        else setCatalog(await addCatalogOption(tab.kind, name));
        setDraft("");
      },
      "Added",
      "Add failed",
    );
  }

  async function onRename(from: string) {
    const to = renameValue.trim();
    if (!to || to === from) {
      setRenaming(null);
      return;
    }
    await run(
      async () => {
        if ("setting" in tab) {
          await saveWords(
            tab.setting,
            prefs[tab.setting].map((word) => (word === from ? to : word)),
          );
        } else {
          setCatalog(await renameCatalogOption(tab.kind, from, to));
          // A renamed option may have been one of the defaults.
          const next = await fetchSettings();
          applySettings(next);
          setPrefs(next);
        }
        setRenaming(null);
      },
      "Renamed",
      "Rename failed",
    );
  }

  async function onDelete(name: string) {
    await run(
      async () => {
        if ("setting" in tab) {
          await saveWords(
            tab.setting,
            prefs[tab.setting].filter((word) => word !== name),
          );
        } else {
          setCatalog(await deleteCatalogOption(tab.kind, name));
        }
      },
      "Deleted",
      "Delete failed",
    );
  }

  return (
    <>
      <p className="page-subheading">
        The lists the app works from. Renaming an option updates every product or purchase that
        uses it.
      </p>
      <div className="surface-card" style={{ padding: 20 }}>
        <Tabs
          activeKey={tabKey}
          onChange={(key) => {
            setTabKey(key);
            setRenaming(null);
            setDraft("");
          }}
          items={TABS.map((entry) => ({ key: entry.key, label: entry.label }))}
        />
        <p className="import-help">{tab.help}</p>
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
                      description={
                        isSetting
                          ? "The rule stops applying to this word from now on."
                          : "Blocked if any item still uses it."
                      }
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
          {!options.length ? <p className="import-help">Nothing in this list yet.</p> : null}
        </div>
      </div>
    </>
  );
}
