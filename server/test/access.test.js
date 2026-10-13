import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";

// Throwaway values made up for each run; nothing here is a real key or PIN.
const ADMIN_KEY = crypto.randomBytes(12).toString("base64url");
const PIN = "4821";
const OTHER_PIN = "9036";
const MINUTE = 60 * 1000;

const servers = [];
after(() => {
  for (const { server, dir, db, stores } of servers) {
    server.close();
    stores.closeAll();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function startApp(adminKey = ADMIN_KEY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-test-"));
  const clock = { now: Date.now() };
  const { app, db, stores } = createApp({ dataDir: dir, adminKey, now: () => clock.now });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push({ server, dir, db, stores });
  return { base: `http://127.0.0.1:${server.address().port}/api`, clock, db, dir };
}

/** A browser: remembers cookies between requests. */
function browser(base) {
  const jar = new Map();
  return {
    jar,
    async call(method, url, body) {
      const res = await fetch(base + url, {
        method,
        headers: {
          "content-type": "application/json",
          cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const [name, value] = pair.split("=");
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    get(url) {
      return this.call("GET", url);
    },
    post(url, body = {}) {
      return this.call("POST", url, body);
    },
  };
}

async function pairedBrowser(base) {
  const b = browser(base);
  assert.equal((await b.post("/auth/pair", { admin_key: ADMIN_KEY })).status, 200);
  return b;
}

async function unlockedBrowser(base, name = "Home", pin = PIN) {
  const b = await pairedBrowser(base);
  const created = await b.post("/profiles", { name, pin });
  assert.equal(created.status, 201);
  const unlocked = await b.post("/auth/unlock", { profile_id: created.body.profile_id, pin });
  assert.equal(unlocked.status, 200);
  return { b, profileId: created.body.profile_id };
}

test("every data and profile route refuses an unpaired browser", async () => {
  const { base } = await startApp();
  const stranger = browser(base);
  const routes = [
    ["GET", "/products"],
    ["GET", "/catalog"],
    ["GET", "/settings"],
    ["GET", "/backup"],
    ["GET", "/gemini-keys"],
    ["GET", "/profiles"],
    ["POST", "/profiles"],
    ["POST", "/auth/unlock"],
    ["POST", "/profiles/1/reset-pin"],
    ["POST", "/auth/unpair-others"],
    ["DELETE", "/profiles/me"],
    // The same routes spelled with percent-encoding must not slip through.
    ["GET", "/%70roducts"],
    ["GET", "/pro%66iles"],
    ["POST", "/auth/%75nlock"],
  ];
  for (const [method, url] of routes) {
    const res = await stranger.call(method, url, method === "GET" ? undefined : {});
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.body.code, "unpaired", `${method} ${url}`);
  }
});

test("the status route says only whether this browser is paired", async () => {
  const { base } = await startApp();
  const status = await browser(base).get("/auth/status");
  assert.equal(status.status, 200);
  assert.equal(status.body.paired, false);
  assert.equal(status.body.profile, null);
  assert.deepEqual(Object.keys(status.body).sort(), ["app_name", "app_tagline", "paired", "pin_max", "pin_min", "profile"]);
});

test("a wrong admin key does not pair, and a made-up device cookie is rejected", async () => {
  const { base } = await startApp();
  const b = browser(base);
  const wrong = await b.post("/auth/pair", { admin_key: "not-the-key" });
  assert.equal(wrong.status, 401);
  assert.equal(b.jar.size, 0);
  assert.equal((await b.get("/profiles")).status, 403);

  b.jar.set("inv_device", crypto.randomBytes(32).toString("hex"));
  const forged = await b.get("/profiles");
  assert.equal(forged.status, 403);
  assert.equal(forged.body.code, "unpaired");
});

test("with no admin key set, nothing can be paired, not even with an empty key", async () => {
  const { base, dir } = await startApp("");
  const b = browser(base);
  for (const admin_key of ["", "anything", undefined]) {
    const res = await b.post("/auth/pair", { admin_key });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "no_admin_key");
  }
  assert.equal(b.jar.size, 0);
  assert.equal((await b.get("/profiles")).status, 403);
  // The server never writes a key of its own to disk.
  assert.ok(!fs.readdirSync(dir).some((name) => /admin/i.test(name)));
});

test("pairing is rate limited per address", async () => {
  const { base } = await startApp();
  const b = browser(base);
  let last;
  for (let i = 0; i < 21; i += 1) last = await b.post("/auth/pair", { admin_key: "guess" });
  assert.equal(last.status, 429);
  // Even the right key is refused until the window passes.
  assert.equal((await b.post("/auth/pair", { admin_key: ADMIN_KEY })).status, 429);
});

test("an unpaired browser cannot lock a profile by sending wrong PINs", async () => {
  const { base } = await startApp();
  const { b: owner, profileId } = await unlockedBrowser(base);
  await owner.post("/auth/lock");

  const stranger = browser(base);
  for (let i = 0; i < 8; i += 1) {
    const res = await stranger.post("/auth/unlock", { profile_id: profileId, pin: "0000" });
    assert.equal(res.status, 403);
  }
  assert.equal((await owner.post("/auth/unlock", { profile_id: profileId, pin: PIN })).status, 200);
});

test("the profile list never exposes hashes or lockout state", async () => {
  const { base } = await startApp();
  const { b } = await unlockedBrowser(base);
  const list = await b.get("/profiles");
  assert.deepEqual(Object.keys(list.body.profiles[0]).sort(), ["name", "profile_id"]);
});

test("PINs are stored hashed, and device and session tokens as hashes", async () => {
  const { base, db } = await startApp();
  const { b } = await unlockedBrowser(base);
  const profile = db.prepare("SELECT * FROM profiles").get();
  assert.notEqual(profile.pin_hash, PIN);
  assert.ok(!JSON.stringify(profile).includes(PIN));
  assert.notEqual(db.prepare("SELECT token_hash FROM devices").get().token_hash, b.jar.get("inv_device"));
  assert.notEqual(db.prepare("SELECT token_hash FROM sessions").get().token_hash, b.jar.get("inv_session"));
});

test("five wrong PINs lock the profile, then it unlocks again and the counter resets", async () => {
  const { base, clock } = await startApp();
  const { b, profileId } = await unlockedBrowser(base);
  await b.post("/auth/lock");
  const attempt = (pin) => b.post("/auth/unlock", { profile_id: profileId, pin });

  for (let left = 4; left >= 1; left -= 1) {
    const res = await attempt("0000");
    assert.equal(res.status, 401);
    assert.equal(res.body.attempts_left, left);
    assert.equal(res.body.locked_until, "");
  }
  const fifth = await attempt("0000");
  assert.equal(fifth.body.attempts_left, 0);
  assert.ok(fifth.body.locked_until, "the fifth wrong PIN sets a lock");

  // While locked, even the right PIN is refused.
  const whileLocked = await attempt(PIN);
  assert.equal(whileLocked.status, 423);
  assert.equal(whileLocked.body.code, "pin_locked");

  // After the one-minute lock, a further wrong PIN locks for five minutes.
  clock.now += 1 * MINUTE + 1000;
  const sixth = await attempt("0000");
  assert.equal(sixth.status, 401);
  const lockMs = Date.parse(sixth.body.locked_until) - clock.now;
  assert.ok(lockMs > 4 * MINUTE && lockMs <= 5 * MINUTE, `locked for ${lockMs} ms`);
  clock.now += 2 * MINUTE;
  assert.equal((await attempt(PIN)).status, 423);

  // Once it expires the right PIN works and wipes the count.
  clock.now += 4 * MINUTE;
  assert.equal((await attempt(PIN)).status, 200);
  await b.post("/auth/lock");
  const afterReset = await attempt("0000");
  assert.equal(afterReset.body.attempts_left, 4);
});

test("data needs an unlocked profile, and locking ends the session", async () => {
  const { base } = await startApp();
  const b = await pairedBrowser(base);
  const beforeUnlock = await b.get("/products");
  assert.equal(beforeUnlock.status, 401);
  assert.equal(beforeUnlock.body.code, "locked");

  const created = await b.post("/profiles", { name: "Home", pin: PIN });
  await b.post("/auth/unlock", { profile_id: created.body.profile_id, pin: PIN });
  assert.equal((await b.get("/products")).status, 200);

  await b.post("/auth/lock");
  assert.equal((await b.get("/products")).status, 401);
});

test("a session only works on the device that opened it", async () => {
  const { base } = await startApp();
  const { b } = await unlockedBrowser(base);
  const other = await pairedBrowser(base);
  other.jar.set("inv_session", b.jar.get("inv_session"));
  assert.equal((await other.get("/products")).status, 401);
});

test("one profile cannot change or delete another", async () => {
  const { base } = await startApp();
  const { b: first, profileId: firstId } = await unlockedBrowser(base, "First", PIN);
  const { b: second } = await unlockedBrowser(base, "Second", OTHER_PIN);

  // The only profile a session can act on is its own: these use the second profile's session.
  const wrongPin = await second.post("/profiles/me/pin", { current_pin: PIN, new_pin: "1111" });
  assert.equal(wrongPin.status, 401);
  const wrongDelete = await second.call("DELETE", "/profiles/me", { pin: PIN });
  assert.equal(wrongDelete.status, 401);

  await first.post("/auth/lock");
  assert.equal((await first.post("/auth/unlock", { profile_id: firstId, pin: PIN })).status, 200);
});

test("each profile has its own inventory, settings and backup", async () => {
  const { base } = await startApp();
  const { b: first } = await unlockedBrowser(base, "First", PIN);
  const { b: second } = await unlockedBrowser(base, "Second", OTHER_PIN);

  const added = await first.post("/products", { name: "Test Rice", package_count: 2 });
  assert.equal(added.status, 201);
  assert.equal((await first.get("/products")).body.products.length, 1);
  assert.equal((await second.get("/products")).body.products.length, 0);

  // The other profile cannot reach it by id either.
  assert.equal((await second.get(`/products/${added.body.product_id}`)).status, 404);
  assert.equal((await second.call("DELETE", `/products/${added.body.product_id}`)).status, 404);
  assert.equal((await first.get("/products")).body.products.length, 1);

  await first.call("PATCH", "/settings", { app_name: "First House" });
  assert.equal((await first.get("/settings")).body.app_name, "First House");
  assert.notEqual((await second.get("/settings")).body.app_name, "First House");

  assert.equal((await first.get("/backup")).body.tables.products.length, 1);
  assert.equal((await second.get("/backup")).body.tables.products.length, 0);
});

test("inventory from before profiles goes to the oldest profile only", async () => {
  const { base, db } = await startApp();
  db.prepare(
    "INSERT INTO products (product_id, name, name_key, category, notes, last_updated) VALUES (1, 'Old Beans', 'old beans', 'Canned Goods', '', '2026-01-01')",
  ).run();

  const { b: first } = await unlockedBrowser(base, "First", PIN);
  const { b: second } = await unlockedBrowser(base, "Second", OTHER_PIN);
  assert.deepEqual(
    (await first.get("/products")).body.products.map((product) => product.name),
    ["Old Beans"],
  );
  assert.equal((await second.get("/products")).body.products.length, 0);
});

test("deleting a profile takes its inventory out of the app", async () => {
  const { base, dir } = await startApp();
  const { b, profileId } = await unlockedBrowser(base);
  await b.post("/products", { name: "Test Rice" });
  assert.ok(fs.existsSync(path.join(dir, `profile-${profileId}.sqlite`)));

  assert.equal((await b.call("DELETE", "/profiles/me", { pin: PIN })).status, 200);
  assert.ok(!fs.existsSync(path.join(dir, `profile-${profileId}.sqlite`)));
  assert.ok(fs.readdirSync(dir).some((name) => name.startsWith(`deleted-profile-${profileId}-`)));
});

test("changing a PIN needs the current PIN", async () => {
  const { base } = await startApp();
  const { b, profileId } = await unlockedBrowser(base);
  assert.equal((await b.post("/profiles/me/pin", { current_pin: "0000", new_pin: OTHER_PIN })).status, 401);
  assert.equal((await b.post("/profiles/me/pin", { current_pin: PIN, new_pin: "12" })).status, 400);
  assert.equal((await b.post("/profiles/me/pin", { current_pin: PIN, new_pin: OTHER_PIN })).status, 200);

  await b.post("/auth/lock");
  assert.equal((await b.post("/auth/unlock", { profile_id: profileId, pin: PIN })).status, 401);
  assert.equal((await b.post("/auth/unlock", { profile_id: profileId, pin: OTHER_PIN })).status, 200);
});

test("resetting a PIN needs the admin key and signs that profile out everywhere", async () => {
  const { base } = await startApp();
  const { b, profileId } = await unlockedBrowser(base);
  const reset = (admin_key) => b.post(`/profiles/${profileId}/reset-pin`, { admin_key, pin: OTHER_PIN });

  assert.equal((await reset("not-the-key")).status, 401);
  assert.equal((await b.get("/products")).status, 200, "a failed reset changes nothing");

  assert.equal((await reset(ADMIN_KEY)).status, 200);
  assert.equal((await b.get("/products")).status, 401, "existing sessions are ended");
  assert.equal((await b.post("/auth/unlock", { profile_id: profileId, pin: PIN })).status, 401);
  assert.equal((await b.post("/auth/unlock", { profile_id: profileId, pin: OTHER_PIN })).status, 200);
});

test("deleting a profile needs its PIN", async () => {
  const { base } = await startApp();
  const { b } = await unlockedBrowser(base);
  assert.equal((await b.call("DELETE", "/profiles/me", { pin: "0000" })).status, 401);
  assert.equal((await b.call("DELETE", "/profiles/me", { pin: PIN })).status, 200);
  assert.equal((await b.get("/profiles")).body.profiles.length, 0);
  assert.equal((await b.get("/products")).status, 401);
});

test("unpair-others removes other devices and keeps this one; unpair removes this one", async () => {
  const { base } = await startApp();
  const { b: mine } = await unlockedBrowser(base);
  const lostPhone = await pairedBrowser(base);
  assert.equal((await lostPhone.get("/profiles")).status, 200);

  const result = await mine.post("/auth/unpair-others");
  assert.equal(result.body.removed, 1);
  assert.equal((await lostPhone.get("/profiles")).status, 403);
  assert.equal((await mine.get("/products")).status, 200);

  assert.equal((await mine.post("/auth/unpair")).status, 200);
  assert.equal((await mine.get("/profiles")).status, 403);
});

test("unpair-others needs an unlocked profile", async () => {
  const { base } = await startApp();
  const b = await pairedBrowser(base);
  assert.equal((await b.post("/auth/unpair-others")).status, 401);
});
