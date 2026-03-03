#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/services/reserve-api"

ENV_FILE="$API_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required"
  exit 1
fi

cd "$API_DIR"

if [[ ! -d node_modules ]]; then
  echo "node_modules not found; run: (cd services/reserve-api && bun install)"
  exit 1
fi

echo "starting reserve-api on http://127.0.0.1:8788"
bun run dev
