import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { runAs } from "./actor.js";
import { config } from "./config.js";

// Two layers. A browser must first be paired with the admin key (device
// cookie); after that, day-to-day access is a profile's PIN (session cookie).
// Only hashes of the cookie tokens and PINs are stored.

const DEVICE_COOKIE = "inv_device";
const SESSION_COOKIE = "inv_session";
const ADMIN_KEY_FILE = "admin.key";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function loadAdminKey(dataDir) {
  const fromEnv = process.env.ADMIN_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, ADMIN_KEY_FILE);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, `${crypto.randomBytes(12).toString("base64url")}\n`, { mode: 0o600 });
    console.log(`Admin key created. Read it from: ${file}`);
  }
  return fs.readFileSync(file, "utf8").trim();
}

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");

function sameSecret(a, b) {
  return crypto.timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}

function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(pin), salt, 32).toString("hex") };
}

function pinMatches(pin, profile) {
  const { hash } = hashPin(pin, profile.pin_salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(profile.pin_hash, "hex"));
}

function readCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

// Secure is set whenever the request arrived over HTTPS, directly or through a
// proxy that says so. Over plain HTTP (localhost, or a home network without
// TLS) the browser would drop a Secure cookie.
function setCookie(req, res, name, value, maxAgeMs) {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (req.secure || req.headers["x-forwarded-proto"] === "https") parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function rateLimiter({ limit, windowMs }, now) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const recent = (hits.get(key) || []).filter((at) => t - at < windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(t);
    hits.set(key, recent);
    return allowed;
  };
}

function fail(res, status, code, message, extra = {}) {
  res.status(status).json({ error: message, code, ...extra });
}

const pinRule = () => `A PIN is ${config.pinMinDigits} to ${config.pinMaxDigits} digits.`;
const validPin = (pin) =>
  new RegExp(`^\\d{${config.pinMinDigits},${config.pinMaxDigits}}$`).test(String(pin ?? ""));

export function createAuth(
  db,
  { adminKey, now = Date.now, brand = () => ({}), onProfileDeleted = () => {} },
) {
  const pairLimit = rateLimiter(config.pairRateLimit, now);
  const unlockLimit = rateLimiter(config.unlockRateLimit, now);
  const iso = (ms) => new Date(ms).toISOString();
  const tooMany = (res) =>
    fail(res, 429, "rate_limited", "Too many attempts. Wait a few minutes and try again.");

  const findDevice = (req) => {
    const token = readCookies(req)[DEVICE_COOKIE];
    if (!token) return null;
    return db.prepare("SELECT * FROM devices WHERE token_hash = ?").get(sha256(token)) ?? null;
  };

  const findSession = (req, device) => {
    const token = readCookies(req)[SESSION_COOKIE];
    if (!token || !device) return null;
    return (
      db
        .prepare(
          `SELECT s.session_id, s.device_id, p.profile_id, p.name
           FROM sessions s JOIN profiles p ON p.profile_id = s.profile_id
           WHERE s.token_hash = ? AND s.device_id = ? AND s.expires_at > ?`,
        )
        .get(sha256(token), device.device_id, iso(now())) ?? null
    );
  };

  const publicProfile = (row) => ({ profile_id: row.profile_id, name: row.name });
  const profileById = (id) => db.prepare("SELECT * FROM profiles WHERE profile_id = ?").get(Number(id));

  function issueDeviceCookie(req, res, token) {
    setCookie(req, res, DEVICE_COOKIE, token, config.deviceCookieDays * DAY);
  }

  function startSession(req, res, profile) {
    const token = newToken();
    db.prepare(
      "INSERT INTO sessions (token_hash, profile_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      sha256(token),
      profile.profile_id,
      req.device.device_id,
      iso(now() + config.sessionDays * DAY),
      iso(now()),
    );
    setCookie(req, res, SESSION_COOKIE, token, config.sessionDays * DAY);
    // Keep an active device paired: its cookie's year starts again.
    issueDeviceCookie(req, res, readCookies(req)[DEVICE_COOKIE]);
  }

  // ---------- Guards ----------

  function requireDevice(req, res, next) {
    const device = findDevice(req);
    if (!device) return fail(res, 403, "unpaired", "This device is not paired.");
    req.device = device;
    next();
  }

  function requireSession(req, res, next) {
    const session = findSession(req, req.device);
    if (!session) return fail(res, 401, "locked", "Enter your PIN to continue.");
    req.session = session;
    runAs(session.name, next);
  }

  // ---------- Open to anyone: pairing and "am I paired?" ----------

  const publicRouter = Router();

  publicRouter.get("/auth/status", (req, res) => {
    const device = findDevice(req);
    const session = findSession(req, device);
    res.json({
      ...brand(),
      paired: Boolean(device),
      profile: session ? publicProfile(session) : null,
    });
  });

  publicRouter.post("/auth/pair", (req, res) => {
    if (!pairLimit(req.ip)) return tooMany(res);
    if (!sameSecret(String(req.body?.admin_key ?? ""), adminKey)) {
      return fail(res, 401, "wrong_admin_key", "That admin key is not correct.");
    }
    const token = newToken();
    db.prepare("INSERT INTO devices (token_hash, label, created_at) VALUES (?, ?, ?)").run(
      sha256(token),
      String(req.headers["user-agent"] || "").slice(0, 200),
      iso(now()),
    );
    issueDeviceCookie(req, res, token);
    res.json({ paired: true });
  });

  // ---------- Paired devices: profiles and unlocking ----------

  const deviceRouter = Router();

  deviceRouter.get("/profiles", (_req, res) => {
    res.json({
      profiles: db.prepare("SELECT profile_id, name FROM profiles ORDER BY profile_id ASC").all(),
    });
  });

  deviceRouter.post("/profiles", (req, res) => {
    const name = String(req.body?.name ?? "").trim().slice(0, 40);
    if (!name) return fail(res, 400, "invalid", "Give the profile a name.");
    if (!validPin(req.body?.pin)) return fail(res, 400, "invalid", pinRule());
    const { salt, hash } = hashPin(req.body.pin);
    const info = db
      .prepare("INSERT INTO profiles (name, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?)")
      .run(name, hash, salt, iso(now()));
    res.status(201).json(publicProfile({ profile_id: Number(info.lastInsertRowid), name }));
  });

  deviceRouter.post("/auth/unlock", (req, res) => {
    if (!unlockLimit(req.ip)) return tooMany(res);
    const profile = profileById(req.body?.profile_id);
    if (!profile) return fail(res, 404, "not_found", "That profile no longer exists.");

    if (profile.locked_until && profile.locked_until > iso(now())) {
      return fail(res, 423, "pin_locked", "Too many wrong PINs. Try again later.", {
        locked_until: profile.locked_until,
        attempts_left: 0,
      });
    }

    if (!validPin(req.body?.pin) || !pinMatches(req.body.pin, profile)) {
      // The fifth wrong PIN in a row locks the profile; each one after that locks it for longer.
      const attempts = profile.failed_attempts + 1;
      const overBy = attempts - config.pinFreeAttempts;
      const steps = config.pinLockMinutes;
      const lockedUntil =
        overBy >= 0 ? iso(now() + steps[Math.min(overBy, steps.length - 1)] * MINUTE) : "";
      db.prepare("UPDATE profiles SET failed_attempts = ?, locked_until = ? WHERE profile_id = ?").run(
        attempts,
        lockedUntil,
        profile.profile_id,
      );
      return fail(res, 401, "wrong_pin", "Wrong PIN.", {
        attempts_left: Math.max(0, config.pinFreeAttempts - attempts),
        locked_until: lockedUntil,
      });
    }

    db.prepare("UPDATE profiles SET failed_attempts = 0, locked_until = '' WHERE profile_id = ?").run(
      profile.profile_id,
    );
    startSession(req, res, profile);
    res.json({ profile: publicProfile(profile) });
  });

  // A forgotten PIN is replaced with the admin key; everyone signed in to that profile is signed out.
  deviceRouter.post("/profiles/:id/reset-pin", (req, res) => {
    if (!pairLimit(req.ip)) return tooMany(res);
    if (!sameSecret(String(req.body?.admin_key ?? ""), adminKey)) {
      return fail(res, 401, "wrong_admin_key", "That admin key is not correct.");
    }
    if (!validPin(req.body?.pin)) return fail(res, 400, "invalid", pinRule());
    const profileId = Number(req.params.id);
    const { salt, hash } = hashPin(req.body.pin);
    const changed = db
      .prepare(
        "UPDATE profiles SET pin_hash = ?, pin_salt = ?, failed_attempts = 0, locked_until = '' WHERE profile_id = ?",
      )
      .run(hash, salt, profileId).changes;
    if (!changed) return fail(res, 404, "not_found", "That profile no longer exists.");
    db.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);
    res.json({ ok: true });
  });

  deviceRouter.post("/auth/lock", (req, res) => {
    const token = readCookies(req)[SESSION_COOKIE];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    setCookie(req, res, SESSION_COOKIE, "", 0);
    res.json({ ok: true });
  });

  deviceRouter.post("/auth/unpair", (req, res) => {
    db.prepare("DELETE FROM devices WHERE device_id = ?").run(req.device.device_id);
    setCookie(req, res, SESSION_COOKIE, "", 0);
    setCookie(req, res, DEVICE_COOKIE, "", 0);
    res.json({ ok: true });
  });

  // ---------- Unlocked profile: managing itself ----------

  const profileRouter = Router();

  profileRouter.post("/auth/unpair-others", (req, res) => {
    const removed = db
      .prepare("DELETE FROM devices WHERE device_id <> ?")
      .run(req.device.device_id).changes;
    res.json({ removed });
  });

  profileRouter.post("/profiles/me/pin", (req, res) => {
    if (!unlockLimit(req.ip)) return tooMany(res);
    const profile = profileById(req.session.profile_id);
    if (!validPin(req.body?.current_pin) || !pinMatches(req.body.current_pin, profile)) {
      return fail(res, 401, "wrong_pin", "The current PIN is not correct.");
    }
    if (!validPin(req.body?.new_pin)) return fail(res, 400, "invalid", pinRule());
    const { salt, hash } = hashPin(req.body.new_pin);
    db.prepare("UPDATE profiles SET pin_hash = ?, pin_salt = ? WHERE profile_id = ?").run(
      hash,
      salt,
      profile.profile_id,
    );
    // Other devices signed in to this profile need the new PIN.
    db.prepare("DELETE FROM sessions WHERE profile_id = ? AND session_id <> ?").run(
      profile.profile_id,
      req.session.session_id,
    );
    res.json({ ok: true });
  });

  profileRouter.delete("/profiles/me", (req, res) => {
    if (!unlockLimit(req.ip)) return tooMany(res);
    const profile = profileById(req.session.profile_id);
    if (!validPin(req.body?.pin) || !pinMatches(req.body.pin, profile)) {
      return fail(res, 401, "wrong_pin", "That PIN is not correct.");
    }
    db.prepare("DELETE FROM profiles WHERE profile_id = ?").run(profile.profile_id);
    onProfileDeleted(profile.profile_id);
    setCookie(req, res, SESSION_COOKIE, "", 0);
    res.json({ ok: true });
  });

  return { publicRouter, deviceRouter, profileRouter, requireDevice, requireSession };
}
