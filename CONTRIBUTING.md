# Contributing to Household Inventory

Thanks for wanting to help. This project is a local inventory web app (Express + React + SQLite, optional Gemini). Keep secrets and personal inventory out of the repo.

## Secrets first

Do **not** commit, upload, or paste:

- `.env` or API keys (`GEMINI_API_KEY`, `INVENTORY_API_KEY`)
- Photos or rows from a real pantry / medicine inventory
- Deploy SSH keys

Use made-up item names and placeholder tokens in fixtures.

## Dev setup

You need Node.js 20+.

```bash
git clone https://github.com/mohdahmedasif/household-inventory.git
cd household-inventory
cp .env.example .env
npm install
npm run install:all
npm run dev
```

Open http://127.0.0.1:5173 (Vite; API on `:3000`).

## Pull requests

1. Open an issue first for larger changes, or grab a [good first issue](https://github.com/mohdahmedasif/household-inventory/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
2. Keep the diff focused — one problem per PR.
3. Match the existing TypeScript / Express style. Do not reformat unrelated files.
4. Describe *why* the change exists, not only what you edited.

## Useful places to contribute

- Inventory API I/O and Gemini parsing with **fake** rows
- UI copy, empty states, accessibility
- A sanitized screenshot of the inventory UI for the README

## License

By contributing you agree your work is licensed under the [MIT License](./LICENSE).
