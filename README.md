# Household Inventory

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3D6B4F" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node 20+">
  <a href="https://github.com/mohdahmedasif/household-inventory/issues?q=is%3Aissue+is%3Aopen+label%3A%22good%20first%20issue%22"><img src="https://img.shields.io/badge/good%20first%20issue-welcome-7057ff" alt="Good first issues"></a>
</p>

Open-source household pantry app: a **React** web UI backed by **SQLite**, an **Express** API, and optional **Google Gemini** photo extract.

In development Vite proxies `/api` to Express. In Docker (and production) Express serves the built SPA and the REST API from one process.

## Features

- Track products and purchase batches (count, location, size, expiry)
- Search and filter the pantry; overview charts and a spreadsheet-style report
- Add from a photo — Gemini fills the form for review
- Editable catalog lists (categories, locations, package types)
- Import from a Google Sheets CSV export

## Architecture

```text
server/     → Express + SQLite REST API (`/api`), serves `dist` in production
client/     → React 19 / Vite / Ant Design SPA
scripts/    → deploy, sheet import, UI screenshots
deploy/     → systemd unit for the Node API
```

## Requirements

- Node.js 20+
- Optional: [Google AI Studio](https://aistudio.google.com/) Gemini API key (photo extract)

## Quick start

```bash
git clone https://github.com/mohdahmedasif/household-inventory.git
cd household-inventory
copy .env.example .env   # or: cp .env.example .env
npm install
npm run install:all
```

Fill `.env` (see below), then:

```bash
npm run dev
```

Open **http://127.0.0.1:5173** (Vite proxies `/api` to Express on `:3000`).

Production-style (Express serves the built SPA):

```bash
npm run build
npm start
```

Then open **http://127.0.0.1:3000**.

### Docker

```bash
docker compose up --build
```

Express serves the Vite bundle from `dist`; SQLite lives in the `household-inventory-data` volume. Host port defaults to 3000; set `INVENTORY_HOST_PORT` to use another one.

## Configuration

Copy `.env.example` → `.env`.

```env
GEMINI_API_KEY=...
INVENTORY_API_KEY=choose-a-long-random-string
# INVENTORY_HOST_PORT=3030
```

`INVENTORY_API_KEY` protects the REST API and web UI (`Authorization: Bearer …`). If unset, the API is open on that host.

Never commit `.env` — it is gitignored. Do not paste API keys into issues or pull requests.

## Inventory schema

Inventory is modeled as **products**, **companies**, and **purchase batches**:

| Entity | Meaning |
|--------|---------|
| **Product** | The thing you stock (matched by normalized name + category) |
| **Company** | Brand / manufacturer on a purchase |
| **Batch** | One purchase/lot — count on hand, location, size, expiry, acquired date |

- Same product bought twice (even from different companies) stays one product with two batches.
- **Times purchased** = number of batches. **On hand** = sum of batch `package_count`.
- Sheet CSV `item_id` is kept as `batch_id` (deleted ids are never reused). Sheet `brand` becomes the company; `last_updated` becomes `acquired_on`.
- Categories / locations / package types are editable catalog lists.

### Import from Google Sheets

1. Open the sheet tab → **File → Download → Comma Separated Values (.csv)**
2. Save as `data/inventory-export.csv` (or paste into the web **Import** page)
3. Run:

```bash
npm run import:sheet
# or: node scripts/import-sheet-csv.mjs path/to/export.csv
```

Rows with the same name + category collapse into one product; each row becomes a purchase batch.

## Deploying on a VPS

### One-time setup

```bash
git clone https://github.com/mohdahmedasif/household-inventory.git
cd household-inventory
cp .env.example .env   # fill secrets
npm run install:all
npm run build

sudo cp deploy/inventory.service /etc/systemd/system/inventory.service
# edit User= / paths
sudo systemctl daemon-reload
sudo systemctl enable --now inventory
```

Or with Docker:

```bash
docker compose up -d --build
```

### Updating

On the server, [`scripts/deploy.sh`](scripts/deploy.sh) pulls `main`, installs dependencies,
rebuilds the SPA and restarts the app:

```bash
bash scripts/deploy.sh
```

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

Browse [good first issues](https://github.com/mohdahmedasif/household-inventory/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) if you want a small place to start.

## License

MIT — see [LICENSE](LICENSE).
