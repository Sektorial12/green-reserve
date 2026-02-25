#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PAYLOAD_FILE="${PAYLOAD_FILE:-./workflows/greenreserve-workflow/payloads/deposit-allowlisted.json}"
CONFIG_FILE="${CONFIG_FILE:-./workflows/greenreserve-workflow/config.staging.json}"

SEPOLIA_RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
BASE_RPC="${BASE_RPC:-https://sepolia.base.org}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "cast (foundry) is required"
  exit 1
fi

cd "$REPO_ROOT"

DEPOSIT_ID="$(jq -r .depositId "$PAYLOAD_FILE")"
TO="$(jq -r .to "$PAYLOAD_FILE")"

ISSUER="$(jq -r .sepoliaIssuerAddress "$CONFIG_FILE")"
RECEIVER="$(jq -r .baseSepoliaReceiverAddress "$CONFIG_FILE")"
TOKENB="$(jq -r .baseSepoliaTokenBAddress "$CONFIG_FILE")"

echo "depositId=$DEPOSIT_ID"
echo "to=$TO"
echo

echo "[sepolia] issuer=$ISSUER"
USED=$(cast call "$ISSUER" "usedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$SEPOLIA_RPC")
echo "usedDepositId=$USED"
echo

echo "[base] receiver=$RECEIVER"
PROCESSED=$(cast call "$RECEIVER" "processedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$BASE_RPC")
echo "processedDepositId=$PROCESSED"

if [[ "$PROCESSED" == "true" ]]; then
  echo
  echo "[base] tokenB=$TOKENB"
  BAL=$(cast call "$TOKENB" "balanceOf(address)(uint256)" "$TO" --rpc-url "$BASE_RPC")
  echo "tokenBBalance=$BAL"
fi
