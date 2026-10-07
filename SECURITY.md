# Security

Household Inventory stores a Gemini API key (optional) and an inventory API key on the machine that runs it. Treat those like passwords. Inventory rows live in a local SQLite file.

## Do not file in public issues

- Gemini keys or `INVENTORY_API_KEY`
- Photos or rows from a real inventory
- `.env` contents or deploy SSH keys

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/mohdahmedasif/household-inventory/security/advisories/new) so tokens and inventory details stay off the public issue tracker.
