import { useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  addGeminiKey,
  deleteGeminiKey,
  fetchGeminiKeys,
  fetchGeminiModels,
  fetchSettings,
  getApiKey,
  setApiKey,
  testGeminiKey,
  updateSettings,
  type GeminiKeyList,
  type Settings,
} from "../api";
import { applySettings } from "../settings";

export default function SettingsPage() {
  const { message } = AntdApp.useApp();
  const [apiKeyDraft, setApiKeyDraft] = useState(getApiKey());
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<Settings>();
  const [keyForm] = Form.useForm<{ key: string }>();
  const [gemini, setGemini] = useState<GeminiKeyList>({ keys: [] });
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [keyBusy, setKeyBusy] = useState<number | "add" | null>(null);

  // The model list comes from Google, so it needs a working key.
  function loadModels() {
    fetchGeminiModels()
      .then(({ models: rows }) =>
        setModels(
          rows.map((row) => ({
            value: row.name,
            label: row.label ? `${row.name} — ${row.label}` : row.name,
          })),
        ),
      )
      .catch(() => setModels([]));
  }

  async function onAddKey(values: { key: string }) {
    setKeyBusy("add");
    try {
      setGemini(await addGeminiKey(values.key ?? ""));
      keyForm.resetFields();
      loadModels();
      message.success("Key checked with Google and saved");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not save the key");
    } finally {
      setKeyBusy(null);
    }
  }

  async function onTestKey(keyId: number) {
    setKeyBusy(keyId);
    try {
      const result = await testGeminiKey(keyId);
      setGemini(result);
      if (result.ok) message.success("Google accepts this key");
      else message.error(result.error);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setKeyBusy(null);
    }
  }

  async function onDeleteKey(keyId: number) {
    try {
      setGemini(await deleteGeminiKey(keyId));
      loadModels();
      message.success("Key removed");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not remove the key");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await fetchSettings();
        if (cancelled) return;
        form.setFieldsValue(prefs);
        setGemini(await fetchGeminiKeys());
        loadModels();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Failed to load settings");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form, message]);

  async function onSave(values: Settings) {
    setSaving(true);
    try {
      const next = await updateSettings(values);
      applySettings(next);
      form.setFieldsValue(next);
      message.success("Settings saved");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p className="page-subheading">
        How the app behaves, saved in the database for everyone who uses it.
      </p>
      <Form form={form} layout="vertical" onFinish={(values) => void onSave(values)}>
        <div className="form-sections">
          <Card title="Expiry" className="surface-card">
            <div className="form-row">
              <Form.Item
                name="expiring_soon_days"
                label="Count as “expiring soon” within (days)"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={365} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="expiry_countdown_days"
                label="Show “N days left” instead of the date within (days)"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} max={730} style={{ width: "100%" }} />
              </Form.Item>
            </div>
          </Card>

          <Card title="Lists" className="surface-card">
            <div className="form-row">
              <Form.Item
                name="top_companies_count"
                label="Companies shown on Overview"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={50} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="card_notes_count"
                label="Batch notes shown on a Pantry card"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} max={10} style={{ width: "100%" }} />
              </Form.Item>
            </div>
          </Card>

          <Card title="Reading photos" className="surface-card">
            <div className="form-row">
              <Form.Item
                name="gemini_model"
                label="Gemini model"
                className="form-field-wide"
                rules={[{ required: true }]}
                tooltip="The list shows the models your API key can use."
              >
                <Select showSearch options={models} placeholder="Add an API key to list models" />
              </Form.Item>
              <Form.Item
                name="gemini_fallback_model"
                label="Fallback model"
                className="form-field-wide"
                rules={[{ required: true }]}
                tooltip="Used when the main model is overloaded."
              >
                <Select showSearch options={models} placeholder="Add an API key to list models" />
              </Form.Item>
            </div>
            <Form.Item
              name="extract_language"
              label="Language for names read from photos"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
          </Card>

          <Card title="App" className="surface-card">
            <div className="form-row">
              <Form.Item
                name="app_name"
                label="Name"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="app_tagline"
                label="Tagline"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </div>
          </Card>

          <div>
            <Button type="primary" size="large" htmlType="submit" loading={saving}>
              Save settings
            </Button>
          </div>
        </div>
      </Form>

      <Card title="Gemini API keys" className="surface-card stack-gap">
        <Typography.Paragraph type="secondary">
          Used to read product photos. Keys are stored encrypted and are never shown again after
          saving; only the last four characters are kept for display. If one key is rejected or
          out of quota, the next one is tried.
        </Typography.Paragraph>
        <div className="catalog-list">
          {gemini.keys.map((entry) => (
            <div key={entry.key_id} className="catalog-row key-row">
              <div className="key-row-text">
                <strong>Key ending in {entry.hint}</strong>
                <span>
                  Added {dayjs(entry.created_at).format("D MMM YYYY")}
                  {entry.last_used_at
                    ? ` · last used ${dayjs(entry.last_used_at).format("D MMM YYYY, HH:mm")}`
                    : " · not used yet"}
                </span>
                {!entry.readable ? (
                  <span className="key-row-error">
                    Cannot be decrypted on this server. Remove it and add the key again.
                  </span>
                ) : entry.last_error ? (
                  <span className="key-row-error">{entry.last_error}</span>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="small"
                  loading={keyBusy === entry.key_id}
                  disabled={!entry.readable}
                  onClick={() => void onTestKey(entry.key_id)}
                >
                  Test
                </Button>
                <Popconfirm
                  title="Remove this key?"
                  description="It is deleted from the database and cannot be recovered."
                  onConfirm={() => void onDeleteKey(entry.key_id)}
                >
                  <Button size="small" danger>
                    Remove
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ))}
          {!gemini.keys.length ? (
            <p className="import-help">No keys yet. Photo reading is off until you add one.</p>
          ) : null}
        </div>
        <Form
          form={keyForm}
          layout="vertical"
          className="stack-gap"
          onFinish={(values) => void onAddKey(values)}
        >
          <Form.Item
            name="key"
            label="API key"
            rules={[{ required: true, message: "Paste an API key" }]}
          >
            <Input.Password autoComplete="off" placeholder="Paste a key from Google AI Studio" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={keyBusy === "add"}>
            Check and save key
          </Button>
        </Form>
      </Card>

      <Card title="App access key" className="surface-card stack-gap">
        <Typography.Paragraph type="secondary">
          The password for this app itself, if the server has one. Stored only in this browser
          session; must match <code>KEY</code> on the server.
        </Typography.Paragraph>
        <Form
          layout="vertical"
          onFinish={(values: { key: string }) => {
            setApiKey(values.key.trim());
            setApiKeyDraft(values.key.trim());
            message.success("API key updated for this session");
          }}
          initialValues={{ key: apiKeyDraft }}
        >
          <Form.Item name="key" label="Bearer token">
            <Input.Password placeholder="Leave blank if the API is open" />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Save API key
          </Button>
        </Form>
      </Card>
    </>
  );
}
