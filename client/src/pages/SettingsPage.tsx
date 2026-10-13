import { useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  addGeminiKey,
  changePin,
  deleteProfile,
  deleteGeminiKey,
  fetchGeminiKeys,
  fetchGeminiModels,
  fetchAccessStatus,
  fetchSettings,
  testGeminiKey,
  unpairDevice,
  unpairOtherDevices,
  updateSettings,
  type GeminiKeyList,
  type Settings,
} from "../api";
import { pinRules } from "../access/AccessScreens";
import { useAccess } from "../access/context";
import { applySettings } from "../settings";

export default function SettingsPage() {
  const { message } = AntdApp.useApp();
  const access = useAccess();
  const [pinForm] = Form.useForm<{ current_pin: string; new_pin: string }>();
  const [pinLimits, setPinLimits] = useState({ pin_min: 0, pin_max: 0 });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchAccessStatus()
      .then((status) => setPinLimits(status))
      .catch(() => undefined);
  }, []);

  async function onChangePin(values: { current_pin: string; new_pin: string }) {
    try {
      await changePin(values.current_pin, values.new_pin);
      pinForm.resetFields();
      message.success("PIN changed");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not change the PIN");
    }
  }

  async function onUnpairThis() {
    try {
      await unpairDevice();
      access.restart();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not unpair");
    }
  }

  async function onUnpairOthers() {
    try {
      const { removed } = await unpairOtherDevices();
      message.success(removed ? `Unpaired ${removed} other device${removed === 1 ? "" : "s"}` : "No other devices were paired");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not unpair the other devices");
    }
  }

  async function onDeleteProfile(values: { pin: string }) {
    try {
      await deleteProfile(values.pin);
      setDeleting(false);
      access.restart();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not delete the profile");
    }
  }

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
            <Form.Item
              name="auto_lock_minutes"
              label="Ask for the PIN again after (minutes in the background)"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={240} style={{ width: "100%" }} />
            </Form.Item>
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

      <Card title={`Access · ${access.profile.name}`} className="surface-card stack-gap">
        <Form form={pinForm} layout="vertical" onFinish={(values) => void onChangePin(values)}>
          <div className="form-row">
            <Form.Item
              name="current_pin"
              label="Current PIN"
              className="form-field-wide"
              rules={[{ required: true, message: "Enter your current PIN" }]}
            >
              <Input.Password inputMode="numeric" autoComplete="off" maxLength={pinLimits.pin_max} />
            </Form.Item>
            <Form.Item name="new_pin" label="New PIN" className="form-field-wide" rules={pinRules(pinLimits)}>
              <Input.Password inputMode="numeric" autoComplete="new-password" maxLength={pinLimits.pin_max} />
            </Form.Item>
          </div>
          <Button type="primary" htmlType="submit">
            Change PIN
          </Button>
        </Form>
        <Space wrap className="stack-gap">
          <Popconfirm
            title="Unpair this device?"
            description="It will need the admin key to be used again."
            onConfirm={() => void onUnpairThis()}
          >
            <Button>Unpair this device</Button>
          </Popconfirm>
          <Popconfirm
            title="Unpair every other device?"
            description="Use this if a phone or laptop was lost. Each one needs the admin key again."
            onConfirm={() => void onUnpairOthers()}
          >
            <Button>Unpair other devices</Button>
          </Popconfirm>
          <Button danger onClick={() => setDeleting(true)}>
            Delete profile
          </Button>
        </Space>
      </Card>

      <Modal
        title={`Delete ${access.profile.name}?`}
        open={deleting}
        onCancel={() => setDeleting(false)}
        footer={null}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          This removes the profile, its PIN and everything in its inventory.
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={(values) => void onDeleteProfile(values)}>
          <Form.Item name="pin" label="PIN" rules={[{ required: true, message: "Enter this profile’s PIN" }]}>
            <Input.Password autoFocus inputMode="numeric" autoComplete="off" maxLength={pinLimits.pin_max} />
          </Form.Item>
          <Button danger type="primary" htmlType="submit" block>
            Delete profile
          </Button>
        </Form>
      </Modal>
    </>
  );
}
