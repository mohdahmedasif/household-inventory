# Contributing to Relay

Thanks for wanting to help. This hub talks to Telegram, Gemini, and Google Sheets — keep secrets and personal inventory out of the repo.

## Secrets first

Do **not** commit, upload, or paste:

- `.env` or bot tokens
- `credentials.json` / service-account keys
- Spreadsheet IDs, worksheet gids, or Telegram user IDs
- Photos or rows from a real pantry / medicine sheet

Use made-up item names and placeholder tokens in fixtures.

## Dev setup

You need Python 3.11+.

```bash
git clone https://github.com/mohdahmedasif/telegram-automation.git
cd telegram-automation
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS / Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill only what you need for local testing, then:

```bash
python main.py
```

Open http://127.0.0.1:8765

## Pull requests

1. Open an issue first for larger changes, or grab a [good first issue](https://github.com/mohdahmedasif/telegram-automation/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
2. Keep the diff focused — one problem per PR.
3. Match the existing Python style. Do not reformat unrelated files.
4. Describe *why* the change exists, not only what you edited.

## Adding another automation

1. Create `automations/your_bot/` with an `Automation` subclass (`automations/base.py`).
2. Register it in `app/registry.py`.
3. Document its `YOURBOT_*` env vars in `.env.example` and the README.

It will appear automatically in the Relay UI.

## Useful places to contribute

- Extra automations (chores, reminders, shopping lists)
- Tests around sheet I/O and Gemini parsing with **fake** rows
- UI copy, empty states, accessibility on the Relay dashboard
- A sanitized screenshot of the hub for the README

## License

By contributing you agree your work is licensed under the [MIT License](./LICENSE).
