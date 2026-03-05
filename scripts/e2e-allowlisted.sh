#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILE="$REPO_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required"
    exit 1
  fi
}

require_cmd curl
require_cmd jq
require_cmd cre
require_cmd cast
require_cmd node

USE_TS_CLI="${USE_TS_CLI:-1}"

GREENRESERVE_CMD=()
CLI_DIR="$REPO_ROOT/cli"
if [[ "$USE_TS_CLI" == "1" ]]; then
  if command -v greenreserve >/dev/null 2>&1; then
    GREENRESERVE_CMD=(greenreserve)
  elif command -v bun >/dev/null 2>&1 && [[ -f "$CLI_DIR/src/index.ts" ]]; then
    if [[ ! -d "$CLI_DIR/node_modules" ]]; then
      echo "warning: greenreserve TS CLI dependencies not installed; run: (cd cli && bun install)"
    else
      GREENRESERVE_CMD=(bun "$CLI_DIR/src/index.ts")
    fi
  fi
fi

cast_uint() {
  if [[ "$#" -gt 0 ]]; then
    echo "$1" | tr -d '\r' | awk '{print $1}'
  else
    tr -d '\r' | awk '{print $1}'
  fi
}

lower() {
  echo "$1" | tr '[:upper:]' '[:lower:]'
}

TARGET="${TARGET:-staging-settings}"
TRIGGER_INDEX="${TRIGGER_INDEX:-0}"
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/workflows/greenreserve-workflow/config.staging.json}"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "config file not found: $CONFIG_FILE"
  exit 1
fi

RESERVE_API_BASE_URL="${RESERVE_API_BASE_URL:-$(jq -r .reserveApiBaseUrl "$CONFIG_FILE")}" 
RESERVE_API_BASE_URL="${RESERVE_API_BASE_URL%/}"

if ! curl -sf "$RESERVE_API_BASE_URL/health" >/dev/null; then
  echo "reserve-api health check failed: $RESERVE_API_BASE_URL/health"
  echo "start it with: ./scripts/demo-start-reserve-api.sh"
  exit 1
fi

if [[ -z "${CRE_ETH_PRIVATE_KEY:-}" ]]; then
  echo "CRE_ETH_PRIVATE_KEY must be set (export it or put it in ./code/.env)"
  exit 1
fi

SEPOLIA_RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
BASE_RPC="${BASE_RPC:-https://sepolia.base.org}"

SEPOLIA_CHAIN_SELECTOR="${SEPOLIA_CHAIN_SELECTOR:-16015286601757825753}"

ISSUER="$(jq -r .sepoliaIssuerAddress "$CONFIG_FILE")"
SENDER="$(jq -r .sepoliaSenderAddress "$CONFIG_FILE")"
ISSUER_WR="$(jq -r .sepoliaIssuerWriteReceiverAddress "$CONFIG_FILE")"
SENDER_WR="$(jq -r .sepoliaSenderWriteReceiverAddress "$CONFIG_FILE")"
RECEIVER="$(jq -r .baseSepoliaReceiverAddress "$CONFIG_FILE")"
TOKENB="$(jq -r .baseSepoliaTokenBAddress "$CONFIG_FILE")"

ISSUER_OPERATOR="$(cast call "$ISSUER" "operator()(address)" --rpc-url "$SEPOLIA_RPC")"
SENDER_OPERATOR="$(cast call "$SENDER" "operator()(address)" --rpc-url "$SEPOLIA_RPC")"

if [[ "$(lower "$ISSUER_OPERATOR")" != "$(lower "$ISSUER_WR")" ]]; then
  echo "issuer operator mismatch"
  echo "issuer=$ISSUER"
  echo "operator=$ISSUER_OPERATOR"
  echo "expected=$ISSUER_WR"
  exit 1
fi

if [[ "$(lower "$SENDER_OPERATOR")" != "$(lower "$SENDER_WR")" ]]; then
  echo "sender operator mismatch"
  echo "sender=$SENDER"
  echo "operator=$SENDER_OPERATOR"
  echo "expected=$SENDER_WR"
  exit 1
fi

DEPOSIT_ID_PROVIDED="0"
if [[ -n "${DEPOSIT_ID:-}" ]]; then
  DEPOSIT_ID_PROVIDED="1"
fi

BASE_PAYLOAD="$REPO_ROOT/workflows/greenreserve-workflow/payloads/deposit-allowlisted.json"
if [[ ! -f "$BASE_PAYLOAD" ]]; then
  echo "payload file not found: $BASE_PAYLOAD"
  exit 1
fi

BASE_TO="$(jq -r '.to // empty' "$BASE_PAYLOAD")"
BASE_AMOUNT="$(jq -r '.amount // empty' "$BASE_PAYLOAD")"
BASE_SCENARIO="$(jq -r '.scenario // empty' "$BASE_PAYLOAD")"

TO_PROVIDED="0"
if [[ -n "${TO:-}" ]]; then
  TO_PROVIDED="1"
fi

AMOUNT_PROVIDED="0"
if [[ -n "${AMOUNT:-}" ]]; then
  AMOUNT_PROVIDED="1"
fi

SCENARIO_PROVIDED="0"
if [[ -n "${SCENARIO:-}" ]]; then
  SCENARIO_PROVIDED="1"
fi

TO="${TO:-$BASE_TO}"
AMOUNT="${AMOUNT:-$BASE_AMOUNT}"
SCENARIO="${SCENARIO:-${BASE_SCENARIO:-healthy}}"

USE_DEPOSIT_NOTICE="${USE_DEPOSIT_NOTICE:-1}"
if [[ "$DEPOSIT_ID_PROVIDED" == "1" && "$USE_DEPOSIT_NOTICE" == "1" ]]; then
  if DEPOSIT_LOOKUP_JSON="$(curl -sf "$RESERVE_API_BASE_URL/deposits?depositId=$DEPOSIT_ID")"; then
    NOTICE_TO="$(echo "$DEPOSIT_LOOKUP_JSON" | jq -r '.notice.onchain.to // empty')"
    NOTICE_AMOUNT="$(echo "$DEPOSIT_LOOKUP_JSON" | jq -r '.notice.amountWei // empty')"
    DEPOSIT_CUSTODIAN_ADDR="$(echo "$DEPOSIT_LOOKUP_JSON" | jq -r '.custodianAddress // empty')"
    DEPOSIT_MESSAGE_HASH="$(echo "$DEPOSIT_LOOKUP_JSON" | jq -r '.messageHash // empty')"

    if [[ "$TO_PROVIDED" == "0" && -n "${NOTICE_TO:-}" ]]; then
      TO="$NOTICE_TO"
    fi
    if [[ "$AMOUNT_PROVIDED" == "0" && -n "${NOTICE_AMOUNT:-}" ]]; then
      AMOUNT="$NOTICE_AMOUNT"
    fi
  else
    echo "warning: could not fetch deposit notice from reserve-api; continuing with provided/default to/amount"
  fi
fi

if [[ "$DEPOSIT_ID_PROVIDED" == "1" && "$USE_DEPOSIT_NOTICE" == "1" ]]; then
  if [[ -z "${TO:-}" || -z "${AMOUNT:-}" ]]; then
    echo "deposit notice lookup did not provide to/amount"
    echo "depositId=$DEPOSIT_ID"
    echo "hint: register the deposit notice first (run without DEPOSIT_ID) or provide TO+AMOUNT explicitly"
    exit 1
  fi
fi

if [[ "$DEPOSIT_ID_PROVIDED" == "0" ]]; then
  if [[ -z "${TO:-}" ]]; then
    TO="$(cast wallet address --private-key "$CRE_ETH_PRIVATE_KEY")"
  fi
  if [[ -z "${AMOUNT:-}" ]]; then
    AMOUNT="$(cast to-wei "1" ether | cast_uint)"
  fi
fi

if [[ -t 0 && -z "${NO_PROMPT:-}" ]]; then
  DEFAULT_TO="$(cast wallet address --private-key "$CRE_ETH_PRIVATE_KEY")"

  if [[ "$TO_PROVIDED" == "0" && "$(lower "$TO")" == "$(lower "$BASE_TO")" ]]; then
    read -r -p "recipient address (default $DEFAULT_TO): " TO_IN
    if [[ -n "${TO_IN:-}" ]]; then
      TO="$TO_IN"
    else
      TO="$DEFAULT_TO"
    fi
  fi

  if [[ "$AMOUNT_PROVIDED" == "0" && "$AMOUNT" == "$BASE_AMOUNT" ]]; then
    read -r -p "amount in ETH (default 1): " AMT_ETH
    AMT_ETH="${AMT_ETH:-1}"
    AMOUNT="$(cast to-wei "$AMT_ETH" ether | cast_uint)"
  fi

  if [[ "$SCENARIO_PROVIDED" == "0" && -n "${BASE_SCENARIO:-}" ]]; then
    read -r -p "scenario healthy/unhealthy (default $SCENARIO): " SCENARIO_IN
    if [[ -n "${SCENARIO_IN:-}" ]]; then
      SCENARIO="$SCENARIO_IN"
    fi
  fi
fi

if [[ ! "$TO" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "invalid TO address: $TO"
  exit 1
fi

if [[ ! "$AMOUNT" =~ ^[0-9]+$ ]]; then
  echo "invalid AMOUNT (must be integer wei): $AMOUNT"
  exit 1
fi

if [[ -z "${DEPOSIT_ID:-}" ]]; then
  CUSTODIAN="${CUSTODIAN:-cli}"
  CHAIN_NAME="${CHAIN_NAME:-base-sepolia}"
  CUSTODIAN_PRIVATE_KEY="${CUSTODIAN_PRIVATE_KEY:-$CRE_ETH_PRIVATE_KEY}"
  CUSTODIAN_ADDR="$(cast wallet address --private-key "$CUSTODIAN_PRIVATE_KEY")"
  if [[ "${#GREENRESERVE_CMD[@]}" -gt 0 ]]; then
    AMT_ETH="${AMT_ETH:-}"
    if [[ -z "${AMT_ETH:-}" ]]; then
      AMT_ETH="$(cast from-wei "$AMOUNT" ether)"
    fi
    for _ in 1 2 3 4 5; do
      if ! DEPOSITS_RESP="$("${GREENRESERVE_CMD[@]}" deposit create \
        --json \
        --non-interactive \
        --config-file "$CONFIG_FILE" \
        --reserve-api-base-url "$RESERVE_API_BASE_URL" \
        --to "$TO" \
        --amount-eth "$AMT_ETH" \
        --chain "$CHAIN_NAME" \
        --custodian "$CUSTODIAN" \
        --custodian-private-key "$CUSTODIAN_PRIVATE_KEY" \
      )"; then
        echo "greenreserve deposit create failed"
        exit 1
      fi

      DEPOSIT_ID="$(echo "$DEPOSITS_RESP" | jq -r .depositId)"
      DEPOSIT_CUSTODIAN_ADDR="$(echo "$DEPOSITS_RESP" | jq -r '.custodianAddress // empty')"
      DEPOSIT_MESSAGE_HASH="$(echo "$DEPOSITS_RESP" | jq -r '.messageHash // empty')"

      if [[ ! "$DEPOSIT_ID" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
        echo "failed to get depositId from reserve-api"
        echo "response=$DEPOSITS_RESP"
        exit 1
      fi

      USED_PRE="$(cast call "$ISSUER" "usedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$SEPOLIA_RPC")"
      if [[ "$USED_PRE" != "true" ]]; then
        break
      fi
      sleep 1
    done
  else
    for _ in 1 2 3 4 5; do
      TS_NOW="$(date +%s)"
      TO_LC="$(lower "$TO")"
      CUSTODIAN_ADDR_LC="$(lower "$CUSTODIAN_ADDR")"
      NOTICE_MESSAGE="$(printf 'GreenReserveDepositNotice:v1\nversion=%s\ncustodian=%s\nto=%s\nchain=%s\namountWei=%s\ntimestamp=%s\ncustodianAddress=%s' \
        "1" "$CUSTODIAN" "$TO_LC" "$CHAIN_NAME" "$AMOUNT" "$TS_NOW" "$CUSTODIAN_ADDR_LC")"
      NOTICE_SIG="$(cast wallet sign --private-key "$CUSTODIAN_PRIVATE_KEY" "$NOTICE_MESSAGE")"

      NOTICE_JSON="$(jq -nc \
        --arg version "1" \
        --arg custodian "$CUSTODIAN" \
        --arg to "$TO_LC" \
        --arg chain "$CHAIN_NAME" \
        --arg amountWei "$AMOUNT" \
        --arg ts "$TS_NOW" \
        --arg custodianAddress "$CUSTODIAN_ADDR_LC" \
        --arg signature "$NOTICE_SIG" \
        '{version:$version,custodian:$custodian,onchain:{to:$to,chain:$chain},amountWei:$amountWei,timestamp:($ts|tonumber),custodianAddress:$custodianAddress,signature:$signature}'
      )"

      if ! DEPOSITS_RESP="$(curl -sf -X POST -H 'content-type: application/json' --data "$NOTICE_JSON" "$RESERVE_API_BASE_URL/deposits")"; then
        echo "reserve-api /deposits failed"
        echo "url=$RESERVE_API_BASE_URL/deposits"
        echo "ensure reserve-api is running and DEPOSIT_REQUIRE_SIGNATURE config matches"
        exit 1
      fi
      DEPOSIT_ID="$(echo "$DEPOSITS_RESP" | jq -r .depositId)"
      DEPOSIT_CUSTODIAN_ADDR="$(echo "$DEPOSITS_RESP" | jq -r '.custodianAddress // empty')"
      DEPOSIT_MESSAGE_HASH="$(echo "$DEPOSITS_RESP" | jq -r '.messageHash // empty')"
      if [[ ! "$DEPOSIT_ID" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
        echo "failed to get depositId from reserve-api"
        echo "response=$DEPOSITS_RESP"
        exit 1
      fi

      USED_PRE="$(cast call "$ISSUER" "usedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$SEPOLIA_RPC")"
      if [[ "$USED_PRE" != "true" ]]; then
        break
      fi
    done
  fi
fi

TMP_PAYLOAD="$(mktemp)"
cleanup_payload() {
  if [[ -n "${TMP_PAYLOAD:-}" && -f "$TMP_PAYLOAD" ]]; then
    rm -f "$TMP_PAYLOAD"
  fi
}

cleanup_broadcast_log() {
  if [[ -n "${BROADCAST_LOG:-}" && -f "$BROADCAST_LOG" ]]; then
    rm -f "$BROADCAST_LOG"
  fi
}

on_exit() {
  cleanup_payload
  cleanup_broadcast_log
}

trap on_exit EXIT

PAYLOAD_FROM_NOTICE="${PAYLOAD_FROM_NOTICE:-1}"
if [[ "$PAYLOAD_FROM_NOTICE" == "1" ]]; then
  jq --arg depositId "$DEPOSIT_ID" --arg scenario "$SCENARIO" \
    '.depositId=$depositId | .scenario=$scenario | del(.to) | del(.amount)' \
    "$BASE_PAYLOAD" >"$TMP_PAYLOAD"
else
  jq --arg depositId "$DEPOSIT_ID" --arg to "$TO" --arg amount "$AMOUNT" --arg scenario "$SCENARIO" \
    '.depositId=$depositId | .to=$to | .amount=$amount | .scenario=$scenario' \
    "$BASE_PAYLOAD" >"$TMP_PAYLOAD"
fi

if ! KYC_JSON="$(curl -sf "$RESERVE_API_BASE_URL/policy/kyc?address=$TO")"; then
  echo "reserve-api /policy/kyc failed"
  echo "url=$RESERVE_API_BASE_URL/policy/kyc"
  exit 1
fi
KYC_ALLOWED="$(echo "$KYC_JSON" | jq -r .isAllowed)"
KYC_REASON="$(echo "$KYC_JSON" | jq -r .reason)"
if ! RESERVES_JSON="$(curl -sf "$RESERVE_API_BASE_URL/reserves")"; then
  echo "reserve-api /reserves failed"
  echo "url=$RESERVE_API_BASE_URL/reserves"
  echo "ensure RESERVE_ATTESTATION_PATH and AUDITOR_ADDRESS are set for reserve-api"
  exit 1
fi
RESERVE_RATIO_BPS="$(echo "$RESERVES_JSON" | jq -r .reserveRatioBps)"
RESERVES_AUDITOR="$(echo "$RESERVES_JSON" | jq -r '.auditor // empty')"
RESERVES_PROOF_REF="$(echo "$RESERVES_JSON" | jq -r '.proofRef // empty')"
RESERVES_MESSAGE_HASH="$(echo "$RESERVES_JSON" | jq -r '.messageHash // empty')"

if [[ "$KYC_ALLOWED" != "true" ]]; then
  echo "blocked by policy"
  echo "kycAllowed=$KYC_ALLOWED kycReason=$KYC_REASON"
  exit 1
fi

if ! AI_JSON="$(curl -sfG "$RESERVE_API_BASE_URL/ai/risk-memo" \
  --data-urlencode "depositId=$DEPOSIT_ID" \
  --data-urlencode "to=$TO" \
  --data-urlencode "amount=$AMOUNT" \
  --data-urlencode "reserveRatioBps=$RESERVE_RATIO_BPS" \
  --data-urlencode "kycAllowed=$KYC_ALLOWED" \
  --data-urlencode "kycReason=$KYC_REASON")"; then
  echo "reserve-api /ai/risk-memo failed"
  echo "url=$RESERVE_API_BASE_URL/ai/risk-memo"
  echo "ensure GEMINI_API_KEY is set for reserve-api"
  exit 1
fi
AI_DECISION="$(echo "$AI_JSON" | jq -r '.memo.decision // empty')"
AI_RISK_SCORE="$(echo "$AI_JSON" | jq -r '.memo.riskScore // empty')"
AI_MEMO_SHA="$(echo "$AI_JSON" | jq -r '.memoSha256 // empty')"

if [[ -z "${AI_DECISION:-}" ]]; then
  echo "ai risk memo missing decision"
  exit 1
fi

echo "aiDecision=$AI_DECISION aiRiskScore=$AI_RISK_SCORE aiMemoSha256=$AI_MEMO_SHA"

if [[ "$AI_DECISION" != "approve" ]]; then
  echo "blocked by ai decision"
  exit 1
fi

OP_ADDR="$(cast wallet address --private-key "$CRE_ETH_PRIVATE_KEY")"
OP_BAL_HEX="$(cast rpc --rpc-url "$SEPOLIA_RPC" eth_getBalance "$OP_ADDR" latest | tr -d '"')"
OP_BAL_WEI="$(cast to-dec "$OP_BAL_HEX")"

MIN_OPERATOR_BAL_WEI="${MIN_OPERATOR_BAL_WEI:-2000000000000000}"
if ! node -e 'process.exit(BigInt(process.argv[1]) >= BigInt(process.argv[2]) ? 0 : 1)' "$OP_BAL_WEI" "$MIN_OPERATOR_BAL_WEI"; then
  echo "warning: operator wallet has low balance on Sepolia"
  echo "operator=$OP_ADDR balanceWei=$OP_BAL_WEI"
fi

SRC_ALLOWED="$(cast call "$RECEIVER" "allowlistedSourceChains(uint64)(bool)" "$SEPOLIA_CHAIN_SELECTOR" --rpc-url "$BASE_RPC")"
if [[ "$SRC_ALLOWED" != "true" ]]; then
  echo "receiver source chain not allowlisted"
  echo "receiver=$RECEIVER"
  echo "chainSelector=$SEPOLIA_CHAIN_SELECTOR"
  exit 1
fi

SENDER_ALLOWED="$(cast call "$RECEIVER" "allowlistedSenders(address)(bool)" "$SENDER" --rpc-url "$BASE_RPC")"
if [[ "$SENDER_ALLOWED" != "true" ]]; then
  echo "receiver sender not allowlisted"
  echo "receiver=$RECEIVER"
  echo "sender=$SENDER"
  exit 1
fi

RECEIVER_TOKEN="$(cast call "$RECEIVER" "token()(address)" --rpc-url "$BASE_RPC")"
if [[ "$(lower "$RECEIVER_TOKEN")" != "$(lower "$TOKENB")" ]]; then
  echo "receiver token mismatch"
  echo "receiver=$RECEIVER"
  echo "receiver_token=$RECEIVER_TOKEN"
  echo "expected_tokenB=$TOKENB"
  exit 1
fi

TOKENB_MINTER="$(cast call "$TOKENB" "minter()(address)" --rpc-url "$BASE_RPC")"
if [[ "$(lower "$TOKENB_MINTER")" != "$(lower "$RECEIVER")" ]]; then
  echo "tokenB minter mismatch (destination mint will revert)"
  echo "tokenB=$TOKENB"
  echo "tokenB_minter=$TOKENB_MINTER"
  echo "expected_receiver=$RECEIVER"
  exit 1
fi

DEST_RECEIVER="$(cast call "$SENDER" "destinationReceiver()(address)" --rpc-url "$SEPOLIA_RPC")"
if [[ "$(lower "$DEST_RECEIVER")" != "$(lower "$RECEIVER")" ]]; then
  echo "sender destinationReceiver mismatch"
  echo "sender=$SENDER"
  echo "destinationReceiver_onchain=$DEST_RECEIVER"
  echo "expected_base_receiver=$RECEIVER"
  exit 1
fi

FEE_WEI_RAW="$(cast call "$SENDER" "estimateFee(address,uint256,bytes32)(uint256)" "$TO" "$AMOUNT" "$DEPOSIT_ID" --rpc-url "$SEPOLIA_RPC")"
FEE_WEI="$(cast_uint "$FEE_WEI_RAW")"
SENDER_BAL_HEX="$(cast rpc --rpc-url "$SEPOLIA_RPC" eth_getBalance "$SENDER" latest | tr -d '"')"
SENDER_BAL_WEI="$(cast to-dec "$SENDER_BAL_HEX")"

if ! node -e 'process.exit(BigInt(process.argv[1]) >= BigInt(process.argv[2]) ? 0 : 1)' "$SENDER_BAL_WEI" "$FEE_WEI"; then
  echo "ccip sender contract needs more ETH to pay fees"
  echo "sender=$SENDER balanceWei=$SENDER_BAL_WEI requiredFeeWei=$FEE_WEI_RAW"
  echo "fund it by sending ETH to the sender contract on Sepolia"
  exit 1
fi

echo "reserveApi=$RESERVE_API_BASE_URL"
echo "target=$TARGET"
echo "issuer=$ISSUER"
echo "sender=$SENDER"
echo "receiver=$RECEIVER"
echo "destinationReceiver=$DEST_RECEIVER"
echo "tokenB=$TOKENB"
if [[ -n "${DEPOSIT_CUSTODIAN_ADDR:-}" || -n "${DEPOSIT_MESSAGE_HASH:-}" ]]; then
  echo "depositCustodianAddress=$DEPOSIT_CUSTODIAN_ADDR"
  echo "depositNoticeMessageHash=$DEPOSIT_MESSAGE_HASH"
fi
if [[ -n "${RESERVES_AUDITOR:-}" || -n "${RESERVES_PROOF_REF:-}" || -n "${RESERVES_MESSAGE_HASH:-}" ]]; then
  echo "reservesAuditor=$RESERVES_AUDITOR"
  echo "reservesProofRef=$RESERVES_PROOF_REF"
  echo "reservesMessageHash=$RESERVES_MESSAGE_HASH"
fi
echo "kycAllowed=$KYC_ALLOWED kycReason=$KYC_REASON"
echo "reserveRatioBps=$RESERVE_RATIO_BPS"
echo "depositId=$DEPOSIT_ID"
echo "to=$TO"
echo "amount=$AMOUNT"
echo

declare -x DEPOSIT_ID

SKIP_BROADCAST="${SKIP_BROADCAST:-}"
FORCE_BROADCAST="${FORCE_BROADCAST:-}"

USED_PRE_FINAL="$(cast call "$ISSUER" "usedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$SEPOLIA_RPC")"
PROCESSED_PRE_FINAL="$(cast call "$RECEIVER" "processedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$BASE_RPC")"

if [[ "$USED_PRE_FINAL" == "true" && -z "$FORCE_BROADCAST" && -z "$SKIP_BROADCAST" ]]; then
  echo "note: depositId is already used on Sepolia; skipping broadcast (set FORCE_BROADCAST=1 to override)"
  SKIP_BROADCAST="1"
fi

CCIP_TX_HASH="${CCIP_TX_HASH:-}"
MINT_TX_HASH="${MINT_TX_HASH:-}"
MESSAGE_ID="${MESSAGE_ID:-}"

if [[ -z "$SKIP_BROADCAST" ]]; then
  BROADCAST_LOG="$(mktemp)"
  if [[ "${#GREENRESERVE_CMD[@]}" -gt 0 ]]; then
    CRE_PATH="$(command -v cre)"
    "${GREENRESERVE_CMD[@]}" deposit submit \
      --deposit-id "$DEPOSIT_ID" \
      --scenario "$SCENARIO" \
      --target "$TARGET" \
      --trigger-index "$TRIGGER_INDEX" \
      --payload-file "$TMP_PAYLOAD" \
      --cre-path "$CRE_PATH" 2>&1 | tee "$BROADCAST_LOG"
  else
    PAYLOAD_FILE="$TMP_PAYLOAD" \
      TARGET="$TARGET" \
      TRIGGER_INDEX="$TRIGGER_INDEX" \
      "$REPO_ROOT/scripts/broadcast-engine-logs.sh" 2>&1 | tee "$BROADCAST_LOG"
  fi

  CCIP_TX_HASH="$(grep -oE 'ccip_tx_status=[0-9]+ txHash=0x[0-9a-fA-F]+' "$BROADCAST_LOG" | tail -n 1 | awk -F'txHash=' '{print $2}' | awk '{print $1}')"
  MINT_TX_HASH="$(grep -oE 'mint_tx_status=[0-9]+ txHash=0x[0-9a-fA-F]+' "$BROADCAST_LOG" | tail -n 1 | awk -F'txHash=' '{print $2}' | awk '{print $1}')"

  if [[ -n "${MINT_TX_HASH:-}" ]]; then
    echo "mintTxHash=$MINT_TX_HASH"
  fi

  if [[ -n "${CCIP_TX_HASH:-}" ]]; then
    echo "ccipTxHash=$CCIP_TX_HASH"

    MSG_SENT_SIG="$(cast keccak 'MessageSent(bytes32,bytes32,address,uint256)')"
    SENDER_LC="$(lower "$SENDER")"
    SIG_LC="$(lower "$MSG_SENT_SIG")"

    CCIP_RECEIPT_JSON="$(cast rpc --rpc-url "$SEPOLIA_RPC" eth_getTransactionReceipt "$CCIP_TX_HASH")"
    MESSAGE_ID="$(echo "$CCIP_RECEIPT_JSON" | jq -r --arg addr "$SENDER_LC" --arg sig "$SIG_LC" '((.result // .) | (.logs // []))[] | select((.address|ascii_downcase)==$addr and (.topics[0]|ascii_downcase)==$sig) | .topics[1]' | head -n 1)"

    if [[ -n "${MESSAGE_ID:-}" && "$MESSAGE_ID" != "null" ]]; then
      echo "ccipMessageId=$MESSAGE_ID"
      echo "ccipExplorer=https://ccip.chain.link/msg/$MESSAGE_ID"
    else
      echo "warning: could not decode MessageSent messageId from receipt"
    fi
  fi
else
  echo "skipping broadcast"
  echo "usedDepositId=$USED_PRE_FINAL processedDepositId=$PROCESSED_PRE_FINAL"

  if [[ -n "${CCIP_TX_HASH:-}" ]]; then
    CCIP_TX_HASH="$CCIP_TX_HASH"
    echo "ccipTxHash=$CCIP_TX_HASH"

    MSG_SENT_SIG="$(cast keccak 'MessageSent(bytes32,bytes32,address,uint256)')"
    SENDER_LC="$(lower "$SENDER")"
    SIG_LC="$(lower "$MSG_SENT_SIG")"

    CCIP_RECEIPT_JSON="$(cast rpc --rpc-url "$SEPOLIA_RPC" eth_getTransactionReceipt "$CCIP_TX_HASH")"
    MESSAGE_ID="$(echo "$CCIP_RECEIPT_JSON" | jq -r --arg addr "$SENDER_LC" --arg sig "$SIG_LC" '((.result // .) | (.logs // []))[] | select((.address|ascii_downcase)==$addr and (.topics[0]|ascii_downcase)==$sig) | .topics[1]' | head -n 1)"

    if [[ -n "${MESSAGE_ID:-}" && "$MESSAGE_ID" != "null" ]]; then
      echo "ccipMessageId=$MESSAGE_ID"
      echo "ccipExplorer=https://ccip.chain.link/msg/$MESSAGE_ID"
    else
      echo "warning: could not decode MessageSent messageId from receipt"
    fi
  fi
fi

echo

timeout_sec="${TIMEOUT_SEC:-1800}"
interval_sec="${POLL_INTERVAL_SEC:-15}"
deadline=$(( $(date +%s) + timeout_sec ))

used="false"
processed="false"

while [[ $(date +%s) -lt $deadline ]]; do
  used="$(cast call "$ISSUER" "usedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$SEPOLIA_RPC")"
  processed="$(cast call "$RECEIVER" "processedDepositId(bytes32)(bool)" "$DEPOSIT_ID" --rpc-url "$BASE_RPC")"

  echo "usedDepositId=$used processedDepositId=$processed"

  if [[ "$used" == "true" && "$processed" == "true" ]]; then
    bal="$(cast call "$TOKENB" "balanceOf(address)(uint256)" "$TO" --rpc-url "$BASE_RPC")"
    echo "tokenB=$TOKENB"
    echo "tokenBBalance=$bal"
    echo "ok"
    exit 0
  fi

  sleep "$interval_sec"
done

echo "timeout waiting for destination processing"
exit 1
