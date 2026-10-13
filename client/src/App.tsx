import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { App as AntdApp } from "antd";
import {
  ApiError,
  fetchAccessStatus,
  fetchProfiles,
  fetchSettings,
  lockSession,
  onAccessLost,
  type Profile,
} from "./api";
import {
  OfflineScreen,
  PairScreen,
  PinScreen,
  ProfilePicker,
  type Brand,
} from "./access/AccessScreens";
import { AccessContext, type Access } from "./access/context";
import { applySettings, settings } from "./settings";
import AppLayout from "./layout/AppLayout";
import CatalogPage from "./pages/CatalogPage";
import ImportPage from "./pages/ImportPage";
import ItemFormPage from "./pages/ItemFormPage";
import ItemsPage from "./pages/ItemsPage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import StatsPage from "./pages/StatsPage";

// pair (first time only) → pick a profile → PIN → app
type Stage =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "pair" }
  | { kind: "pick" }
  | { kind: "pin"; profile: Profile }
  | { kind: "app"; profile: Profile };

// Remembered on this device only: who used it last, when the app went to the
// background, and how long it may stay there before the PIN is asked again.
const LAST_PROFILE = "inventory.lastProfile";
const HIDDEN_AT = "inventory.hiddenAt";
const AUTO_LOCK_MINUTES = "inventory.autoLockMinutes";
const BRAND = "inventory.brand";

function recall<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function awayTooLong(): boolean {
  const hiddenAt = recall<number>(HIDDEN_AT);
  const minutes = recall<number>(AUTO_LOCK_MINUTES);
  return Boolean(hiddenAt && minutes && Date.now() - hiddenAt > minutes * 60 * 1000);
}

export default function App() {
  const { message } = AntdApp.useApp();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [brand, setBrand] = useState<Brand>(
    () => recall<Brand>(BRAND) ?? { app_name: "", app_tagline: "", pin_min: 0, pin_max: 0 },
  );
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const enterApp = useCallback(
    async (profile: Profile) => {
      try {
        const loaded = await fetchSettings();
        applySettings(loaded);
        localStorage.setItem(LAST_PROFILE, JSON.stringify(profile));
        localStorage.setItem(AUTO_LOCK_MINUTES, JSON.stringify(loaded.auto_lock_minutes));
        localStorage.removeItem(HIDDEN_AT);
        setStage({ kind: "app", profile });
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Could not load the app");
      }
    },
    [message],
  );

  const lock = useCallback(async (profile: Profile) => {
    await lockSession().catch(() => undefined);
    localStorage.removeItem(HIDDEN_AT);
    setStage({ kind: "pin", profile });
  }, []);

  // Work out where this browser stands: unpaired, paired, or already unlocked.
  const start = useCallback(async () => {
    try {
      const status = await fetchAccessStatus();
      setBrand(status);
      localStorage.setItem(BRAND, JSON.stringify(status));
      document.title = [status.app_name, status.app_tagline].filter(Boolean).join(" · ");
      if (!status.paired) return setStage({ kind: "pair" });
      if (status.profile) {
        if (awayTooLong()) return void lock(status.profile);
        return void enterApp(status.profile);
      }
      const last = recall<Profile>(LAST_PROFILE);
      const { profiles } = await fetchProfiles();
      const known = profiles.find((profile) => profile.profile_id === last?.profile_id);
      setStage(known ? { kind: "pin", profile: known } : { kind: "pick" });
    } catch (err) {
      // No answer at all (rather than an error answer) means the server is out of reach.
      if (err instanceof ApiError) message.error(err.message);
      else setStage({ kind: "offline" });
    }
  }, [enterApp, lock, message]);

  useEffect(() => {
    void start();
  }, [start]);

  // The server can end access at any time (unpaired elsewhere, session expired).
  useEffect(() => {
    onAccessLost((state) => {
      const current = stageRef.current;
      if (state === "unpaired") setStage({ kind: "pair" });
      else if (current.kind === "app") setStage({ kind: "pin", profile: current.profile });
    });
    return () => onAccessLost(() => undefined);
  }, []);

  // Auto-lock: note when the app goes to the background, and ask for the PIN
  // again if it comes back (or is reopened) after too long.
  const unlockedProfile = stage.kind === "app" ? stage.profile : null;
  useEffect(() => {
    if (!unlockedProfile) return;
    // Keep the first moment it went out of view: closing a tab that was
    // already in the background must not restart the clock.
    const onHide = () => {
      if (!recall<number>(HIDDEN_AT)) localStorage.setItem(HIDDEN_AT, JSON.stringify(Date.now()));
    };
    const onChange = () => {
      if (document.visibilityState === "hidden") return onHide();
      localStorage.setItem(AUTO_LOCK_MINUTES, JSON.stringify(settings().auto_lock_minutes));
      if (awayTooLong()) void lock(unlockedProfile);
      else localStorage.removeItem(HIDDEN_AT);
    };
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("pagehide", onHide);
    };
  }, [unlockedProfile, lock]);

  const access = useMemo<Access | null>(() => {
    if (!unlockedProfile) return null;
    return {
      profile: unlockedProfile,
      lock: () => void lock(unlockedProfile),
      switchProfile: () => {
        void lockSession()
          .catch(() => undefined)
          .then(() => {
            localStorage.removeItem(LAST_PROFILE);
            setStage({ kind: "pick" });
          });
      },
      restart: () => {
        localStorage.removeItem(LAST_PROFILE);
        setStage({ kind: "loading" });
        void start();
      },
    };
  }, [unlockedProfile, lock, start]);

  if (stage.kind === "loading") return null;
  if (stage.kind === "offline") return <OfflineScreen brand={brand} onRetry={() => void start()} />;
  if (stage.kind === "pair") return <PairScreen brand={brand} onPaired={() => void start()} />;
  if (stage.kind === "pick") {
    return <ProfilePicker brand={brand} onPick={(profile) => setStage({ kind: "pin", profile })} />;
  }
  if (stage.kind === "pin") {
    return (
      <PinScreen
        key={stage.profile.profile_id}
        brand={brand}
        profile={stage.profile}
        onUnlocked={(profile) => void enterApp(profile)}
        onBack={() => {
          localStorage.removeItem(LAST_PROFILE);
          setStage({ kind: "pick" });
        }}
      />
    );
  }

  return (
    <AccessContext.Provider value={access}>
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
    </AccessContext.Provider>
  );
}
