#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PAYLOAD_FILE="${PAYLOAD_FILE:-./workflows/greenreserve-workflow/payloads/deposit-allowlisted.json}"
CONFIG_FILE="${CONFIG_FILE:-./workflows/greenreserve-workflow/config.staging.json}"

SEPOLIA_RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
BASE_RPC="${BASE_RPC:-https://sepolia.base.org}"
RESERVE_API_BASE_URL="${RESERVE_API_BASE_URL:-http://localhost:8788}"

ENV_FILE="$REPO_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "cast (foundry) is required"
  exit 1
fi

cd "$REPO_ROOT"

DEPOSIT_ID="${DEPOSIT_ID:-$(jq -r .depositId "$PAYLOAD_FILE")}"
TO="$(jq -r '.to // empty' "$PAYLOAD_FILE")"

if [[ ! "$DEPOSIT_ID" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "invalid depositId: $DEPOSIT_ID"
  exit 1
fi

if [[ -z "${TO:-}" || "$TO" == "null" ]]; then
  if command -v curl >/dev/null 2>&1; then
    if DEPOSIT_JSON="$(curl -sf "$RESERVE_API_BASE_URL/deposits?depositId=$DEPOSIT_ID")"; then
      TO="$(echo "$DEPOSIT_JSON" | jq -r '.notice.onchain.to // empty')"
    fi
  fi
fi

ISSUER="$(jq -r .sepoliaIssuerAddress "$CONFIG_FILE")"
RECEIVER="$(jq -r .baseSepoliaReceiverAddress "$CONFIG_FILE")"
TOKENB="$(jq -r .baseSepoliaTokenBAddress "$CONFIG_FILE")"

echo "depositId=$DEPOSIT_ID"
echo "to=$TO"
echo

echo "[sepolia] issuer=$ISSUER"
USED=$(cast call "$ISSUER" "usedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$SEPOLIA_RPC")
echo "usedDepositId=$USED"
if [[ "$USED" == "true" ]]; then
  echo "hint: usedDepositId is already true; choose a fresh DEPOSIT_ID (e.g., export DEPOSIT_ID=0x...)"
fi
echo

echo "[base] receiver=$RECEIVER"
PROCESSED=$(cast call "$RECEIVER" "processedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$BASE_RPC")
echo "processedDepositId=$PROCESSED"

if [[ "$PROCESSED" == "true" ]]; then
  echo
  echo "[base] tokenB=$TOKENB"
  if [[ -z "${TO:-}" || ! "$TO" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "warning: missing/invalid to address; cannot check TokenB balance"
    echo "hint: run reserve-api and ensure /deposits?depositId=... returns notice.onchain.to"
  else
    BAL=$(cast call "$TOKENB" "balanceOf(address)(uint256)" "$TO" --rpc-url "$BASE_RPC")
    echo "tokenBBalance=$BAL"
  fi
fi
