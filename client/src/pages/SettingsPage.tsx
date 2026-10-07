import { useEffect, useState } from "react";
import { App as AntdApp, Button, Card, Form, Input, Select, Typography } from "antd";
import {
  fetchCatalog,
  fetchSettings,
  getApiKey,
  setApiKey,
  updateSettings,
  type Catalog,
  type Settings,
} from "../api";

export default function SettingsPage() {
  const { message } = AntdApp.useApp();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
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
        setSettings(prefs);
        form.setFieldsValue(prefs);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Failed to load settings");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form, message]);

  return (
    <>
      <p className="page-subheading">Defaults for new products, and the API key this browser uses.</p>
      <div className="form-sections">
        <Card title="New product defaults" className="surface-card">
          <Form
            form={form}
            layout="vertical"
            onFinish={async (values) => {
              setSaving(true);
              try {
                const next = await updateSettings(values);
                setSettings(next);
                message.success("Defaults saved");
              } catch (err) {
                message.error(err instanceof Error ? err.message : "Save failed");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Form.Item name="default_category" label="Default category" rules={[{ required: true }]}>
              <Select options={(catalog?.categories ?? []).map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Form.Item name="default_location" label="Default location" rules={[{ required: true }]}>
              <Select options={(catalog?.locations ?? []).map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Form.Item
              name="default_package_type"
              label="Default package type"
              rules={[{ required: true }]}
            >
              <Select options={(catalog?.package_types ?? []).map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              Save defaults
            </Button>
          </Form>
          {settings ? (
            <Typography.Paragraph type="secondary" className="stack-gap">
              Current: {settings.default_category} · {settings.default_location} ·{" "}
              {settings.default_package_type}
            </Typography.Paragraph>
          ) : null}
        </Card>

        <Card title="API key" className="surface-card">
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
      </div>
    </>
  );
}
