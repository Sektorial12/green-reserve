#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-staging-settings}"
TRIGGER_INDEX="${TRIGGER_INDEX:-0}"
PAYLOAD_FILE="${PAYLOAD_FILE:-./workflows/greenreserve-workflow/payloads/deposit-allowlisted.json}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v cre >/dev/null 2>&1; then
  echo "cre CLI not found on PATH"
  exit 1
fi

if [[ -z "${CRE_ETH_PRIVATE_KEY:-}" ]]; then
  echo "CRE_ETH_PRIVATE_KEY must be set (export it or put it in ./code/.env)"
  exit 1
fi

cd "$REPO_ROOT"

cre workflow simulate ./workflows/greenreserve-workflow \
  -R . \
  -T "$TARGET" \
  --trigger-index "$TRIGGER_INDEX" \
  --http-payload "@$PAYLOAD_FILE" \
  --broadcast \
  --non-interactive
