import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { App as AntdApp, Button, Card, Form, Input, Typography } from "antd";
import { AuthError, fetchAuthStatus, fetchSettings, getApiKey, setApiKey } from "./api";
import { applySettings } from "./settings";
import AppLayout from "./layout/AppLayout";
import CatalogPage from "./pages/CatalogPage";
import ImportPage from "./pages/ImportPage";
import ItemFormPage from "./pages/ItemFormPage";
import ItemsPage from "./pages/ItemsPage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import StatsPage from "./pages/StatsPage";

export default function App() {
  const { message } = AntdApp.useApp();
  const [ready, setReady] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [brand, setBrand] = useState({ app_name: "", app_tagline: "" });

  // Settings come from the database and must be in place before any page renders.
  async function start() {
    try {
      applySettings(await fetchSettings());
      setNeedsKey(false);
      setReady(true);
    } catch (err) {
      if (err instanceof AuthError) {
        setNeedsKey(true);
        return;
      }
      message.error(err instanceof Error ? err.message : "Could not reach the API");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchAuthStatus();
        if (cancelled) return;
        setBrand(status);
        if (status.required && !getApiKey()) setNeedsKey(true);
        else await start();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Could not reach the API");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  if (needsKey) {
    return (
      <div className="login-wrap">
        <div className="login-stack">
          <div className="login-hero">
            <img src="/logo.svg" alt="" />
            <h1>{brand.app_name}</h1>
            <p>{brand.app_tagline}</p>
          </div>
        <Card className="login-card" title="Unlock">
          <Typography.Paragraph type="secondary">
            This API is protected. Paste the same <code>INVENTORY_API_KEY</code> you set on the
            server.
          </Typography.Paragraph>
          <Form
            layout="vertical"
            onFinish={(values: { key: string }) => {
              setApiKey(values.key.trim());
              void start();
            }}
          >
            <Form.Item
              name="key"
              label="API key"
              rules={[{ required: true, message: "Enter the API key" }]}
            >
              <Input.Password autoFocus />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block>
              Continue
            </Button>
          </Form>
        </Card>
        </div>
      </div>
    );
  }

  if (!ready) return null;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<ItemsPage />} />
        <Route path="/products/new" element={<ItemFormPage />} />
        <Route path="/products/:id" element={<ItemFormPage />} />
        <Route path="/items/new" element={<Navigate to="/products/new" replace />} />
        <Route path="/items/:id" element={<ItemFormPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
