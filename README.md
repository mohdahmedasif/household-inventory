# Stocked

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3D6B4F" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node 20+">
  <img src="https://img.shields.io/badge/react-19-61DAFB" alt="React 19">
  <img src="https://img.shields.io/badge/sqlite-local-0f766e" alt="SQLite">
  <a href="https://github.com/mohdahmedasif/household-inventory/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22"><img src="https://img.shields.io/badge/good%20first%20issue-welcome-7057ff" alt="Good first issues"></a>
</p>

**Self-hosted household pantry** for groceries, medicine and supplies. Track what you own, where it lives, and when it expires — with an optional Gemini photo scan that fills the add form for you.

## Why

Spreadsheets drift. Stocked keeps a clean product list, every purchase as its own batch, and a simple web UI you can run at home or on a VPS.

## Features

| | |
|---|---|
| **Pantry** | Search, filter by category or location, sort by name, expiry, or stock |
| **Products & batches** | One product, many purchases — on hand is the sum of batch counts |
| **Photo add** | Pick or take a label photo; Gemini drafts the fields for review |
| **History** | Every change in a batch's count is logged per product |
| **Overview** | What needs attention, plus counts by category, location and company |
| **Reports** | Spreadsheet-style table with CSV export and print |
| **Catalog** | Edit categories, locations, package types, units and text rules in place |
| **Backup** | Download everything as one file and restore it on a fresh install |
| **Import** | Bring in an old Google Sheets CSV |

## Stack

```text
client/   React 19 · Vite · Ant Design
server/   Express · better-sqlite3 · optional Gemini extract
deploy/   Docker Compose · systemd unit
```

In **dev**, Vite serves the UI on `:5173` and proxies `/api` to Express on `:3000`.
In **production / Docker**, Express serves the built SPA and API from one process.

## Quick start

**Requirements:** Node.js 20+. Optional: a [Gemini API key](https://aistudio.google.com/) for photo extract.

```bash
git clone https://github.com/mohdahmedasif/household-inventory.git
cd household-inventory
npm install
npm run install:all
npm run dev
```

Open **http://127.0.0.1:5173**.

### Production build (local)

```bash
npm run build
npm start
```

Open **http://127.0.0.1:3000**.

### Docker

```bash
docker compose up -d --build
```

- App: **http://127.0.0.1:3000** (or the `PORT` you set)
- Data: Docker volume `household-inventory-data`

## Configuration

The app reads two environment variables, both optional. Copy [`.env.example`](.env.example) → `.env` to set them.

| Variable | Purpose |
|----------|---------|
| `PORT` | The port the app is opened on (default `3000`) |
| `KEY` | A password for the API and web UI (`Authorization: Bearer …`). Leave unset only on a network you trust. |

Everything else is set in the app and stored in the database:

- **Settings** — expiry windows, list sizes, the Gemini model, app name, and Gemini API keys.
- **Catalog** — categories, locations, package types, units, and the text rules.

Gemini API keys are stored encrypted. The encryption key is the `secret.key` file in the data directory; without it, saved keys cannot be read and must be entered again.

Never commit `.env`, `secret.key`, a database, or a backup file. Don't paste keys into issues or PRs.

## Data model

| Entity | Meaning |
|--------|---------|
| **Product** | The thing you stock (matched by name + category) |
| **Company** | Brand on a purchase |
| **Batch** | One purchase — count, location, size, expiry, acquired date |

- Buy the same product twice → one product, two batches.
- Add a purchase identical to an existing batch → that batch's count goes up.
- **On hand** = sum of batch counts.

### Backup and restore

**Import → Full backup** downloads one JSON file with every product, purchase, history entry, catalog list and setting. Restoring it replaces everything in the app with the file's contents. Gemini API keys are not part of the backup.

### Import from Google Sheets

1. Sheet tab → **File → Download → CSV**
2. Use the web **Import** page, or save as `data/inventory-export.csv` and run:

```bash
npm run import:sheet
# or: node scripts/import-sheet-csv.mjs path/to/export.csv
```

Rows with the same name + category merge into one product; each row becomes a batch.

## Deploy

### Docker on a VPS

```bash
git clone https://github.com/mohdahmedasif/household-inventory.git
cd household-inventory
cp .env.example .env   # set KEY
docker compose up -d --build
```

### systemd (Node)

```bash
npm run install:all && npm run build
sudo cp deploy/inventory.service /etc/systemd/system/inventory.service
# edit User= and paths, then:
sudo systemctl daemon-reload
sudo systemctl enable --now inventory
```

### Updating

On the server, [`scripts/deploy.sh`](scripts/deploy.sh) pulls `main`, installs dependencies, rebuilds the SPA and restarts the app:

```bash
bash scripts/deploy.sh
```

Put the app behind HTTPS and set `KEY` whenever it is reachable from the internet.

## Contributing

PRs and issues welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).
Security reports: [SECURITY.md](./SECURITY.md).

## License

[MIT](LICENSE)
