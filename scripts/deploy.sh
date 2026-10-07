#!/usr/bin/env bash
# Pull latest main, install deps, rebuild the SPA, restart the inventory API.
# Used by GitHub Actions (SSH) and safe to run manually on the VPS:
#   bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"
OWNER="$(stat -c '%U' "$ROOT")"

echo "==> Deploying Household Inventory in $ROOT (branch: $BRANCH)"

if [ ! -d .git ]; then
  echo "ERROR: $ROOT is not a git repository."
  exit 1
fi

# Root deploying into a non-root-owned tree (common on this VPS).
git config --global --add safe.directory "$ROOT" 2>/dev/null || true

echo "==> git fetch / pull"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ "$(id -u)" -eq 0 ] && [ "$OWNER" != "root" ]; then
  chown -R "${OWNER}:${OWNER}" "$ROOT/.git" || true
fi

echo "==> Inventory UI + API (Node)"
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found"
  exit 1
fi

npm --prefix "$ROOT/server" install --omit=dev
npm --prefix "$ROOT/client" install
npm --prefix "$ROOT/client" run build
node "$ROOT/scripts/copy-client-dist.cjs"

echo "==> Restart"
bash "$ROOT/scripts/restart.sh"

echo "==> Deploy complete ($(git rev-parse --short HEAD))"
