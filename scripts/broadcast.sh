#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-staging-settings}"
TRIGGER_INDEX="${TRIGGER_INDEX:-0}"
PAYLOAD_FILE="${PAYLOAD_FILE:-./workflows/greenreserve-workflow/payloads/deposit-allowlisted.json}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILE="$REPO_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

PAYLOAD_PATH="$PAYLOAD_FILE"
if [[ "$PAYLOAD_PATH" != /* ]]; then
  PAYLOAD_PATH="$REPO_ROOT/$PAYLOAD_PATH"
fi

TMP_PAYLOAD=""
if [[ -n "${DEPOSIT_ID:-}" ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required when DEPOSIT_ID is set"
    exit 1
  fi

  TMP_PAYLOAD="$(mktemp)"
  jq --arg depositId "$DEPOSIT_ID" '.depositId=$depositId' "$PAYLOAD_PATH" >"$TMP_PAYLOAD"
  PAYLOAD_PATH="$TMP_PAYLOAD"
fi

cleanup() {
  if [[ -n "$TMP_PAYLOAD" && -f "$TMP_PAYLOAD" ]]; then
    rm -f "$TMP_PAYLOAD"
  fi
}
trap cleanup EXIT

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
  --http-payload "@$PAYLOAD_PATH" \
  --broadcast \
  --non-interactive
