import { useEffect, useRef, useState, type ReactNode } from "react";
import { App as AntdApp, Button, Card, Form, Input, Modal } from "antd";
import { DeleteOutlined, PlusOutlined, UserOutlined } from "@ant-design/icons";
import {
  ApiError,
  createProfile,
  fetchProfiles,
  pairDevice,
  resetPin,
  unlockProfile,
  type Profile,
} from "../api";

/** What the server tells any visitor: the app's name and how long a PIN may be. */
export type Brand = { app_name: string; app_tagline: string; pin_min: number; pin_max: number };

export const pinRules = (brand: { pin_min: number; pin_max: number }) => [
  { required: true, message: "Enter a PIN" },
  {
    pattern: new RegExp(`^\\d{${brand.pin_min},${brand.pin_max}}$`),
    message: `${brand.pin_min} to ${brand.pin_max} digits`,
  },
];

function Shell({ brand, children }: { brand: Brand; children: ReactNode }) {
  return (
    <div className="login-wrap">
      <div className="login-stack">
        <div className="login-hero">
          <img src="/logo.svg" alt="" />
          <h1>{brand.app_name}</h1>
          <p>{brand.app_tagline}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PairScreen({ brand, onPaired }: { brand: Brand; onPaired: () => void }) {
  const { message } = AntdApp.useApp();
  const [busy, setBusy] = useState(false);

  async function onFinish(values: { admin_key: string }) {
    setBusy(true);
    try {
      await pairDevice(values.admin_key.trim());
      onPaired();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell brand={brand}>
      <Card className="login-card" title="Pair this device">
        <Form layout="vertical" onFinish={(values) => void onFinish(values)}>
          <Form.Item
            name="admin_key"
            label="Admin key"
            rules={[{ required: true, message: "Enter the admin key" }]}
          >
            <Input.Password autoFocus autoComplete="off" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={busy}>
            Pair
          </Button>
        </Form>
      </Card>
    </Shell>
  );
}

export function ProfilePicker({ brand, onPick }: { brand: Brand; onPick: (profile: Profile) => void }) {
  const { message } = AntdApp.useApp();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchProfiles()
      .then(({ profiles: rows }) => setProfiles(rows))
      .catch((err) => message.error(err instanceof Error ? err.message : "Could not load profiles"));
  }, [message]);

  async function onCreate(values: { name: string; pin: string }) {
    setBusy(true);
    try {
      const profile = await createProfile(values.name.trim(), values.pin);
      setAdding(false);
      onPick(profile);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not create the profile");
    } finally {
      setBusy(false);
    }
  }

  const createForm = (
    <Form layout="vertical" onFinish={(values) => void onCreate(values)}>
      <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a name" }]}>
        <Input autoFocus maxLength={40} />
      </Form.Item>
      <Form.Item name="pin" label="PIN" rules={pinRules(brand)}>
        <Input.Password inputMode="numeric" autoComplete="new-password" maxLength={brand.pin_max} />
      </Form.Item>
      <Form.Item
        name="confirm"
        label="PIN again"
        dependencies={["pin"]}
        rules={[
          { required: true, message: "Repeat the PIN" },
          ({ getFieldValue }) => ({
            validator: (_, value) =>
              !value || value === getFieldValue("pin")
                ? Promise.resolve()
                : Promise.reject(new Error("The PINs do not match")),
          }),
        ]}
      >
        <Input.Password inputMode="numeric" autoComplete="new-password" maxLength={brand.pin_max} />
      </Form.Item>
      <Button type="primary" htmlType="submit" size="large" block loading={busy}>
        Create profile
      </Button>
    </Form>
  );

  if (profiles && profiles.length === 0) {
    return (
      <Shell brand={brand}>
        <Card className="login-card" title="Create your profile">
          {createForm}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell brand={brand}>
      <Card className="login-card" title="Who is it?" loading={!profiles}>
        <div className="profile-list">
          {(profiles ?? []).map((profile) => (
            <button key={profile.profile_id} type="button" onClick={() => onPick(profile)}>
              <UserOutlined />
              {profile.name}
            </button>
          ))}
          <button type="button" className="add" onClick={() => setAdding(true)}>
            <PlusOutlined />
            Add profile
          </button>
        </div>
      </Card>
      <Modal title="Add profile" open={adding} onCancel={() => setAdding(false)} footer={null} destroyOnClose>
        {createForm}
      </Modal>
    </Shell>
  );
}

function secondsUntil(iso: string): number {
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000)) : 0;
}

function countdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PinScreen({ brand, profile, onUnlocked, onBack }: {
  brand: Brand;
  profile: Profile;
  onUnlocked: (profile: Profile) => void;
  onBack: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [pin, setPin] = useState("");
  // The ref is the source of truth, so keys typed faster than a re-render are not lost.
  const pinRef = useRef("");
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockedUntil, setLockedUntil] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [forgot, setForgot] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const locked = secondsLeft > 0;

  function update(next: string) {
    pinRef.current = next.slice(0, brand.pin_max);
    setPin(pinRef.current);
  }

  useEffect(() => {
    setSecondsLeft(secondsUntil(lockedUntil));
    if (!lockedUntil) return;
    const timer = setInterval(() => {
      const left = secondsUntil(lockedUntil);
      setSecondsLeft(left);
      if (left === 0) {
        setLockedUntil("");
        setError("");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  async function submit() {
    if (busyRef.current || pinRef.current.length < brand.pin_min) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await unlockProfile(profile.profile_id, pinRef.current);
      onUnlocked(result.profile);
    } catch (err) {
      update("");
      if (err instanceof ApiError && (err.code === "wrong_pin" || err.code === "pin_locked")) {
        const until = String(err.data.locked_until ?? "");
        const left = Number(err.data.attempts_left ?? 0);
        setLockedUntil(until);
        setError(
          until
            ? "Too many wrong PINs."
            : `Wrong PIN, ${left} attempt${left === 1 ? "" : "s"} left`,
        );
      } else {
        setError(err instanceof Error ? err.message : "Could not unlock");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (/^\d$/.test(event.key)) update(pinRef.current + event.key);
      else if (event.key === "Backspace") update(pinRef.current.slice(0, -1));
      else if (event.key === "Enter") void submit();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function onReset(values: { admin_key: string; pin: string }) {
    setResetBusy(true);
    try {
      await resetPin(profile.profile_id, values.admin_key.trim(), values.pin);
      setForgot(false);
      setLockedUntil("");
      setError("");
      message.success("PIN changed. Enter the new one.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not reset the PIN");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <Shell brand={brand}>
      <Card className="login-card" title={profile.name}>
        <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(brand.pin_min, pin.length) }, (_, i) => (
            <span key={i} className={i < pin.length ? "filled" : ""} />
          ))}
        </div>
        <p className={`pin-status${error ? " error" : ""}`} role="status">
          {locked ? `${error} Try again in ${countdown(secondsLeft)}` : error || "Enter your PIN"}
        </p>
        <div className="pin-pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button key={digit} type="button" disabled={locked} onClick={() => update(pinRef.current + digit)}>
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="quiet"
            aria-label="Delete last digit"
            disabled={locked}
            onClick={() => update(pinRef.current.slice(0, -1))}
          >
            <DeleteOutlined />
          </button>
          <button type="button" disabled={locked} onClick={() => update(pinRef.current + "0")}>
            0
          </button>
          <button
            type="button"
            className="go"
            disabled={locked || busy || pin.length < brand.pin_min}
            onClick={() => void submit()}
          >
            OK
          </button>
        </div>
        <div className="pin-links">
          <Button type="link" onClick={onBack}>
            Switch profile
          </Button>
          <Button type="link" onClick={() => setForgot(true)}>
            Forgot PIN?
          </Button>
        </div>
      </Card>
      <Modal title="Reset PIN" open={forgot} onCancel={() => setForgot(false)} footer={null} destroyOnClose>
        <Form layout="vertical" onFinish={(values) => void onReset(values)}>
          <Form.Item
            name="admin_key"
            label="Admin key"
            rules={[{ required: true, message: "Enter the admin key" }]}
          >
            <Input.Password autoFocus autoComplete="off" />
          </Form.Item>
          <Form.Item name="pin" label="New PIN" rules={pinRules(brand)}>
            <Input.Password inputMode="numeric" autoComplete="new-password" maxLength={brand.pin_max} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={resetBusy}>
            Set new PIN
          </Button>
        </Form>
      </Modal>
    </Shell>
  );
}
