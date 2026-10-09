import { useEffect, useState } from "react";
import { App as AntdApp, Button, Card, Form, Input, InputNumber, Select, Typography } from "antd";
import {
  fetchCatalog,
  fetchSettings,
  getApiKey,
  setApiKey,
  updateSettings,
  type Catalog,
  type Settings,
} from "../api";
import { applySettings } from "../settings";

export default function SettingsPage() {
  const { message } = AntdApp.useApp();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState(getApiKey());
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<Settings>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cat, prefs] = await Promise.all([fetchCatalog(), fetchSettings()]);
        if (cancelled) return;
        setCatalog(cat);
        form.setFieldsValue(prefs);
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

  const options = (values: string[] | undefined) =>
    (values ?? []).map((value) => ({ value, label: value }));

  return (
    <>
      <p className="page-subheading">
        How the app behaves, saved in the database for everyone who uses it.
      </p>
      <Form form={form} layout="vertical" onFinish={(values) => void onSave(values)}>
        <div className="form-sections">
          <Card title="New product defaults" className="surface-card">
            <div className="form-row">
              <Form.Item
                name="default_category"
                label="Category"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <Select options={options(catalog?.categories)} />
              </Form.Item>
              <Form.Item
                name="default_location"
                label="Location"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <Select options={options(catalog?.locations)} />
              </Form.Item>
              <Form.Item
                name="default_package_type"
                label="Package type"
                className="form-field-wide"
                rules={[{ required: true }]}
              >
                <Select options={options(catalog?.package_types)} />
              </Form.Item>
            </div>
          </Card>

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

          <Card title="Text rules" className="surface-card">
            <Form.Item
              name="lowercase_units"
              label="Units kept lowercase in names"
              tooltip="Names are capitalized word by word, except these."
            >
              <Select mode="tags" tokenSeparators={[",", " "]} open={false} suffixIcon={null} />
            </Form.Item>
            <Form.Item
              name="blank_words"
              label="Words treated as empty"
              tooltip="A field containing only one of these is saved as blank."
            >
              <Select mode="tags" tokenSeparators={[","]} open={false} suffixIcon={null} />
            </Form.Item>
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

      <Card title="API key" className="surface-card stack-gap">
        <Typography.Paragraph type="secondary">
          Stored only in this browser session. Must match <code>INVENTORY_API_KEY</code> on the server.
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
