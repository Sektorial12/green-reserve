 # GreenReserve (Chainlink CRE)
 
 > **Chainlink CRE Hackathon 2026**
 
 ![Chainlink CRE](https://img.shields.io/badge/Chainlink-CRE-blue) ![CCIP](https://img.shields.io/badge/Chainlink-CCIP-375BD2) ![Solidity](https://img.shields.io/badge/Solidity-0.8.x-green) ![TypeScript](https://img.shields.io/badge/TypeScript-CLI%20%2B%20Workflow-3178C6) ![Sepolia](https://img.shields.io/badge/Networks-Sepolia%20%2F%20Base%20Sepolia-purple)
 
 GreenReserve is a **CLI-first, proof-first reserve-backed minting system** built around **Chainlink Runtime Environment (CRE)** and **Chainlink CCIP**.
 
 It combines off-chain evidence, policy checks, and AI-assisted risk analysis with on-chain audit commitments and cross-chain token delivery.
 
 ## Overview
 
 GreenReserve orchestrates a reserve-backed deposit flow across two networks:
 
 - A signed deposit notice is created and stored by the Reserve API.
 - A Chainlink CRE workflow fetches reserves, compliance, and AI risk data.
 - The workflow commits audit hashes on Sepolia.
 - The workflow mints on the source side and sends the instruction cross-chain with CCIP.
 - A CCIP receiver on Base Sepolia mints the destination-side token.
 
 This makes the issuance pipeline more transparent, auditable, and programmable than a typical opaque “backed asset” workflow.
 
 ## Key Features
 
 - **CLI-first operator flow**
   - `doctor`, `deposit create`, `deposit submit`, `deposit status`
 
 - **Chainlink CRE orchestration**
   - Uses a CRE workflow as the control plane for off-chain and on-chain steps
 
 - **Chainlink CCIP delivery**
   - Delivers mint instructions from Sepolia to Base Sepolia
 
 - **On-chain audit trail**
   - Hashes of reserve evidence, compliance decisions, and AI outputs are committed on-chain
 
 - **Compliance-aware minting**
   - KYC/sanctions checks are evaluated before the workflow proceeds
 
 - **AI risk memo support**
   - Uses Gemini when configured, with controllable fallback behavior
 
 - **Cross-chain proof tooling**
   - CLI can decode the CCIP `MessageSent` event and follow the message through to destination processing
 
 ## Documentation Map
 
 - **Architecture**: [`./architecture.md`](./architecture.md)
 - **Demo runbook**: [`./demo-runbook.md`](./demo-runbook.md)
 - **Demo script / narration**: [`../demo.md`](../demo.md)
 - **Hackathon submission draft**: [`../submission.md`](../submission.md)
 
 ## How It Works
 
 ### 1. Deposit notice creation
 
 The operator creates a signed deposit notice using the CLI. The Reserve API stores the notice and returns a deterministic `depositId`.
 
 ### 2. Workflow validation and orchestration
 
 `deposit submit` triggers the CRE workflow. The workflow:
 
 - Fetches the deposit notice from the Reserve API
 - Fetches a signed reserve attestation
 - Runs KYC / sanctions policy checks
 - Fetches an AI risk memo
 - Verifies signatures and hashes
 
 ### 3. Audit commitment on Sepolia
 
 Before token delivery, the workflow writes audit evidence hashes to an on-chain audit registry. This produces a verifiable record of the evidence and decision path used for the issuance.
 
 ### 4. Source-chain mint and CCIP send
 
 The workflow mints on Sepolia and then calls the CCIP sender contract, which validates the audit state and sends the cross-chain message through the Chainlink CCIP router.
 
 ### 5. Destination-chain receive and mint
 
 On Base Sepolia, the CCIP receiver validates the source and sender allowlists, processes the message, marks the `depositId` as processed, and mints the destination token.
 
 ### 6. Status and proof verification
 
 The CLI can:
 
 - Read audit state
 - Decode the `MessageSent` event from the source transaction receipt
 - Recover the CCIP `messageId`
 - Watch for destination processing and final token delivery
 
 ## Architecture
 
 GreenReserve has four main layers:
 
 - **CLI (`cli/`)**
   - TypeScript command-line interface for operators
 
 - **Reserve API (`services/reserve-api/`)**
   - Bun service serving deposits, reserve evidence, compliance checks, and AI risk memo output
 
 - **CRE workflow (`workflows/greenreserve-workflow/`)**
   - Orchestration layer that binds off-chain checks to on-chain execution
 
 - **Contracts (`contracts/`)**
   - Sepolia source-side contracts and Base Sepolia destination-side contracts
 
 For the full component layout and data flow, see [`./architecture.md`](./architecture.md).
 
 ## Tech Stack
 
 - **Chainlink Runtime Environment (CRE)** for orchestration
 - **Chainlink CCIP** for cross-chain message delivery
 - **Solidity / Foundry** for smart contracts and deployment scripts
 - **TypeScript / Node.js** for the CLI
 - **Bun / TypeScript** for the Reserve API
 - **Viem** for EVM RPC reads, receipt decoding, and event parsing
 
 ## Repository Layout
 
 - `cli/`
   - CLI source, command handlers, and package config
 
 - `contracts/`
   - Solidity contracts and Foundry scripts
 
 - `services/reserve-api/`
   - Reserve attestation, deposits, sanctions, compliance, and AI memo service
 
 - `workflows/greenreserve-workflow/`
   - CRE workflow source, payloads, and staging config
 
 - `scripts/`
   - Demo and end-to-end helper scripts
 
 - `project.yaml`
   - CRE project target configuration
 
 ## Current Network Targets
 
 | Network | Chain name | Selector | CCIP Router |
 |---|---|---:|---|
 | Sepolia | `ethereum-testnet-sepolia` | `16015286601757825753` | `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59` |
 | Base Sepolia | `ethereum-testnet-sepolia-base-1` | `10344971235874465080` | `0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93` |
 
 ## Staging Config Source of Truth
 
 The default CLI config is:
 
 - `workflows/greenreserve-workflow/config.staging.json`
 
 Important configured addresses currently include:
 
 - reserve API: `http://127.0.0.1:8788`
 - Sepolia issuer: `0xb4816cBC7dE40BDB0f506f97E0b4d16136d30cb3`
 - Sepolia sender: `0x2cbe21dC3b2531371f3F58756ab6731b2C6Fb38d`
 - Base Sepolia receiver: `0x44D236a8397d0299b160E534E3e5C271732B1F64`
 - Sepolia audit registry: `0xF3C55cb3BeAcC51FaE4d1f9d22e2BF7c31DfB4FA`
 
 ## Prerequisites
 
 Required tooling:
 
 - `node`
 - `npm`
 - `bun`
 - `jq`
 - `cast`
 - `forge`
 - `cre`
 
 Required runtime inputs:
 
 - a Sepolia-funded `CRE_ETH_PRIVATE_KEY`
 - a `CUSTODIAN_PRIVATE_KEY` for deposit notice signing
 - reserve API configuration with a valid signed reserve attestation
 - a `GEMINI_API_KEY` if you want live Gemini-backed AI risk memo generation
 
 ## Install
 
 From the `code/` directory:
 
 ```bash
 bun install --cwd cli
 bun install --cwd services/reserve-api
 bun install --cwd workflows/greenreserve-workflow
 forge build --root contracts
 npm --prefix cli run build
 ```
 
 ## Environment Setup
 
 The CLI auto-loads `code/.env`.
 
 Example:
 
 ```bash
 cat > .env <<'EOF'
 CRE_ETH_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
 CUSTODIAN_PRIVATE_KEY=0xYOUR_CUSTODIAN_PRIVATE_KEY
 EOF
 ```
 
 Useful optional values:
 
 ```bash
 SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
 BASE_RPC=https://sepolia.base.org
 RESERVE_API_BASE_URL=http://127.0.0.1:8788
 CRE_CLI_PATH=/absolute/path/to/cre
 ```
 
 For the Reserve API:
 
 ```bash
 cp services/reserve-api/.env.example services/reserve-api/.env
 ```
 
 Set at least:
 
 - `RESERVE_ATTESTATION_PATH`
 - `AUDITOR_ADDRESS`
 - `DEPOSITS_DB_PATH`
 - `GEMINI_API_KEY` if using Gemini
 
 ## AI Auditor Setup and Verification
 
 The Reserve API serves the AI auditor endpoint at `GET /ai/risk-memo`.
 
 It calls Gemini if `GEMINI_API_KEY` is set. If Gemini is unavailable and fallback is enabled, it can return a deterministic local memo instead.
 
 Recommended Reserve API `.env` values:
 
 ```bash
 GEMINI_API_KEY=...
 GEMINI_MODEL=gemini-flash-latest
 AI_RISK_MEMO_ALLOW_FALLBACK=false
 ```
 
 Verify Gemini usage:
 
 ```bash
 curl "http://127.0.0.1:8788/ai/risk-memo?depositId=0x0000000000000000000000000000000000000000000000000000000000000001&to=0x0000000000000000000000000000000000000001&amount=1000000000000000000&reserveRatioBps=10000&kycAllowed=true"
 ```
 
 Check that:
 
 - `model` equals your Gemini model, such as `gemini-flash-latest`
 - `model` is not `local-fallback`
 - if fallback is disabled and `GEMINI_API_KEY` is unset, the endpoint fails loudly instead of silently succeeding
 
 ## Quickstart
 
 ### 1. Generate a reserve attestation
 
 ```bash
 AUDITOR_PRIVATE_KEY=0xYOUR_AUDITOR_PRIVATE_KEY \
   bun --cwd services/reserve-api run attest -- \
   --reserves-usd 1500000 \
   --liabilities-usd 1000000 \
   --proof-ref ipfs://greenreserve/staging-proof-001 \
   > services/reserve-api/reserves.local.json
 ```
 
 ### 2. Start the Reserve API
 
 ```bash
 ./scripts/demo-start-reserve-api.sh
 ```
 
 ### 3. Run doctor
 
 ```bash
 npm --prefix cli run greenreserve -- doctor \
   --config-file workflows/greenreserve-workflow/config.staging.json \
   --cre-path "$(command -v cre)"
 ```
 
 ### 4. Create a deposit notice

```bash
npm --prefix cli run greenreserve -- deposit create \
  --json \
  --non-interactive \
  --config-file workflows/greenreserve-workflow/config.staging.json \
  --to 0xYOUR_RECIPIENT_ADDRESS \
  --amount-eth 1 \
  --chain base-sepolia \
  --custodian cli \
  --custodian-private-key "$CUSTODIAN_PRIVATE_KEY"
```

### 5. Submit the deposit

```bash
npm --prefix cli run greenreserve -- deposit submit \
  --deposit-id 0xYOUR_DEPOSIT_ID \
  --scenario healthy \
  --target staging-settings \
  --trigger-index 0 \
  --cre-path "$(command -v cre)"
```

### 6. Check status

```bash
npm --prefix cli run greenreserve -- deposit status \
  --deposit-id 0xYOUR_DEPOSIT_ID \
  --ccip-tx-hash 0xYOUR_SEPOLIA_TX_HASH
```

```bash
npm --prefix cli run greenreserve -- deposit status \
  --deposit-id 0xYOUR_DEPOSIT_ID \
  --message-id 0xYOUR_MESSAGE_ID \
  --watch \
  --interval-sec 15
```

## Helper scripts

- `./scripts/demo-start-reserve-api.sh`
  - starts the reserve API from `services/reserve-api/`

- `./scripts/e2e-allowlisted.sh`
  - runs the full preflight + deposit + submit + poll flow

If you want the fastest full-stack check, use:

```bash
./scripts/e2e-allowlisted.sh
```

## Bun and CRE path note

In this environment, Bun may not inherit the full shell `PATH`.

If the CLI cannot find `cre`, do one of the following:
- pass `--cre-path "$(command -v cre)"`
- export `CRE_CLI_PATH="$(command -v cre)"`

