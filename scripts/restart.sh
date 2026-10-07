#!/usr/bin/env bash
# Restart the inventory API + web UI (systemd when available).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

restart_unit() {
  local unit="$1"
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files --no-legend --type=service 2>/dev/null | grep -q "^${unit}"; then
    if [ "$(id -u)" -eq 0 ]; then
      systemctl restart "$unit"
      systemctl --no-pager --full status "$unit" || true
    else
      sudo systemctl restart "$unit"
      sudo systemctl --no-pager --full status "$unit" || true
    fi
    echo "Restarted ${unit}"
    return 0
  fi
  return 1
}

if restart_unit inventory.service || restart_unit telegram-inventory.service; then
  exit 0
fi

if command -v docker >/dev/null 2>&1 && docker compose ps --status running 2>/dev/null | grep -q inventory; then
  docker compose up -d --build inventory
  echo "Restarted Docker Compose inventory service"
  exit 0
fi

echo "No inventory.service unit or running Compose service found."
echo "Start with: npm start   (after npm run build)"
echo "Or:         docker compose up -d --build"
exit 1
