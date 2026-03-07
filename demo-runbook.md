# GreenReserve Demo Runbook

Step-by-step guide to run a full GreenReserve deposit → mint → CCIP delivery demo.

## Prerequisites

- Node.js and npm
- Bun (for reserve API)
- Foundry (`cast`, `forge`)
- CRE CLI (`cre`)
- A funded Sepolia private key (`CRE_ETH_PRIVATE_KEY`)
- A custodian private key (`CUSTODIAN_PRIVATE_KEY`)
- (Optional) `GEMINI_API_KEY` for real AI risk memo

## 1. Environment Setup

### 1.1 Install dependencies

```bash
cd code
bun install --cwd cli
bun install --cwd services/reserve-api
bun install --cwd workflows/greenreserve-workflow
npm --prefix cli run build
```

### 1.2 Configure environment

```bash
# Main CLI env
cat > .env <<'EOF'
CRE_ETH_PRIVATE_KEY=0xYOUR_SEPOLIA_PRIVATE_KEY
CUSTODIAN_PRIVATE_KEY=0xYOUR_CUSTODIAN_PRIVATE_KEY
EOF

# Reserve API env
cp services/reserve-api/.env.example services/reserve-api/.env
# Edit services/reserve-api/.env and set:
#   RESERVE_ATTESTATION_PATH=./reserves.local.json
#   AUDITOR_ADDRESS=0xYOUR_AUDITOR_ADDRESS
#   DEPOSITS_DB_PATH=./deposits.local.json
#   GEMINI_API_KEY=...  (optional)
#   GEMINI_MODEL=gemini-flash-latest
#   AI_RISK_MEMO_ALLOW_FALLBACK=true
```

## 2. Generate Reserve Attestation

```bash
AUDITOR_PRIVATE_KEY=0xYOUR_AUDITOR_PRIVATE_KEY \
  bun --cwd services/reserve-api run attest -- \
  --reserves-usd 1500000 \
  --liabilities-usd 1000000 \
  --proof-ref ipfs://greenreserve/demo-proof-001 \
  > services/reserve-api/reserves.local.json
```

Verify:
```bash
cat services/reserve-api/reserves.local.json | jq '.reserveRatioBps'
# Should be 15000 (150%)
```

## 3. Start Reserve API

```bash
./scripts/demo-start-reserve-api.sh
```

Or manually:
```bash
cd services/reserve-api && bun run dev
```

Leave this running in a separate terminal.

## 4. Run Doctor

Validate environment and contract linkages:

```bash
npm --prefix cli run greenreserve -- doctor \
  --config-file workflows/greenreserve-workflow/config.staging.json \
  --cre-path "$(command -v cre)"
```

Expected: all checks pass, no failures.

## 5. Create Deposit Notice

```bash
npm --prefix cli run greenreserve -- deposit create \
  --json \
  --non-interactive \
  --config-file workflows/greenreserve-workflow/config.staging.json \
  --to 0xYOUR_RECIPIENT_ADDRESS \
  --amount-eth 0.001 \
  --chain base-sepolia \
  --custodian cli \
  --custodian-private-key "$CUSTODIAN_PRIVATE_KEY"
```

Output includes `depositId`. Save it:
```bash
export DEPOSIT_ID=0x...
```

## 6. Submit Deposit to CRE Workflow

```bash
npm --prefix cli run greenreserve -- deposit submit \
  --deposit-id "$DEPOSIT_ID" \
  --scenario healthy \
  --target staging-settings \
  --trigger-index 0 \
  --cre-path "$(command -v cre)"
```

Default output shows only key workflow markers. Use `--verbose` for full CRE logs.

On success, output includes:
```
result=approved
ccipTxHash=0x...
```

Save the CCIP tx hash:
```bash
export CCIP_TX_HASH=0x...
```

## 7. Decode CCIP Message ID

```bash
npm --prefix cli run greenreserve -- deposit status \
  --deposit-id "$DEPOSIT_ID" \
  --ccip-tx-hash "$CCIP_TX_HASH"
```

Output includes `ccipMessageId`. Save it:
```bash
export MESSAGE_ID=0x...
```

## 8. Watch Destination Processing

```bash
npm --prefix cli run greenreserve -- deposit status \
  --deposit-id "$DEPOSIT_ID" \
  --message-id "$MESSAGE_ID" \
  --watch \
  --interval-sec 15
```

Watch until:
- `baseSepoliaProcessed=true`
- `ccipExplorerUrl` shows success

## 9. Verify Final State

### On-chain checks

```bash
# Sepolia: deposit marked as used
cast call 0xb4816cBC7dE40BDB0f506f97E0b4d16136d30cb3 \
  "usedDepositId(bytes32)(bool)" "$DEPOSIT_ID" \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com

# Base Sepolia: deposit marked as processed
cast call 0x44D236a8397d0299b160E534E3e5C271732B1F64 \
  "processedDepositId(bytes32)(bool)" "$DEPOSIT_ID" \
  --rpc-url https://sepolia.base.org

# Base Sepolia: recipient TokenB balance
cast call 0x20F061Db666A0BC3Fa631C52f8a65DdA287264A1 \
  "balanceOf(address)(uint256)" 0xYOUR_RECIPIENT_ADDRESS \
  --rpc-url https://sepolia.base.org
```

### CCIP Explorer

Visit: `https://ccip.chain.link/msg/<MESSAGE_ID>`

## Troubleshooting

### CRE not found
```bash
export CRE_CLI_PATH="$(command -v cre)"
# or pass --cre-path explicitly
```

### Reserve API not reachable
- Ensure it's running on port 8788
- Check `RESERVE_API_BASE_URL` in config

### AI memo fails
- Verify `GEMINI_API_KEY` is set
- Set `AI_RISK_MEMO_ALLOW_FALLBACK=true` to use fallback

### CCIP send fails
- Check sender contract has sufficient ETH for fees
- Verify sender/receiver allowlisting

## Quick Reference

| Step | Command |
|------|---------|
| Doctor | `npm --prefix cli run greenreserve -- doctor ...` |
| Create | `npm --prefix cli run greenreserve -- deposit create ...` |
| Submit | `npm --prefix cli run greenreserve -- deposit submit ...` |
| Status | `npm --prefix cli run greenreserve -- deposit status ...` |
