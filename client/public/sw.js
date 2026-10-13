// Service worker: keeps the app's own files (HTML, scripts, styles, icons,
// fonts) on the device so it opens instantly and still opens with no
// connection. Inventory data is never cached here: everything under /api/
// always goes to the server.

const CACHE = "stocked-shell-v1";
const OFFLINE_PAGE = "/offline.html";
const ALWAYS = ["/", OFFLINE_PAGE, "/site.webmanifest", "/logo.svg", "/favicon.svg", "/icon-192.png"];

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

/** The hashed script and style files a copy of the page refers to. */
function assetsIn(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
}

/** Store the page and its assets, and drop assets from older builds. */
async function refreshShell(response) {
  const cache = await caches.open(CACHE);
  const assets = assetsIn(await response.clone().text());
  await cache.put("/", response.clone());
  await Promise.all(
    assets.map(async (url) => {
      if (!(await cache.match(url))) await cache.add(url).catch(() => undefined);
    }),
  );
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/assets/") && !assets.includes(pathname)) await cache.delete(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ALWAYS.filter((url) => url !== "/"));
      await refreshShell(await fetch("/", { cache: "no-store" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

// Opening the app: the newest page when online, the saved one when not.
async function openApp(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await refreshShell(response.clone());
    return response;
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match("/")) || (await cache.match(OFFLINE_PAGE));
  }
}

// Files that never change under the same name (hashed assets, icons, fonts).
async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    if (request.mode === "navigate") return event.respondWith(openApp(request));
    if (url.pathname === "/sw.js") return;
    return event.respondWith(fromCacheFirst(request));
  }
  if (FONT_HOSTS.includes(url.hostname)) event.respondWith(fromCacheFirst(request));
});
