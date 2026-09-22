# Security

Relay stores Telegram bot tokens, a Gemini API key, and a Google service-account JSON on the machine that runs it. Treat those like passwords.

## Do not file in public issues

- Bot tokens or Gemini keys
- `credentials.json` / service-account JSON
- Spreadsheet IDs, worksheet gids, or Telegram user IDs
- Photos or rows from a real inventory sheet
- `.env` contents or deploy SSH keys

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/mohdahmedasif/telegram-automation/security/advisories/new) so tokens and sheet details stay off the public issue tracker.
