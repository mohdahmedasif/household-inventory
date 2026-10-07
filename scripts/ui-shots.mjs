import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.UI_BASE_URL || "http://127.0.0.1:3030";
const OUT = path.resolve("tmp/ui-shots");
const API_KEY = process.env.INVENTORY_API_KEY || "";

function loadDotEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();
const key = process.env.INVENTORY_API_KEY || API_KEY;

fs.mkdirSync(OUT, { recursive: true });

const pages = [
  { name: "pantry", path: "/" },
  { name: "overview", path: "/stats" },
  { name: "reports", path: "/reports" },
  { name: "add-product", path: "/products/new" },
  { name: "catalog", path: "/catalog" },
  { name: "settings", path: "/settings" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

if (key) {
  await page.addInitScript((apiKey) => {
    sessionStorage.setItem("inventory.apiKey", apiKey);
  }, key);
}

for (const entry of pages) {
  await page.goto(`${BASE}${entry.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const file = path.join(OUT, `${entry.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
}

// Product detail: first pantry card link
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const productHref = await page.locator('a[href^="/products/"]').first().getAttribute("href");
if (productHref) {
  await page.goto(`${BASE}${productHref}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const file = path.join(OUT, "product.png");
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
} else {
  console.warn("no product link found; skipped product.png");
}

await browser.close();
console.log("done");
