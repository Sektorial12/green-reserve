# GreenReserve (Chainlink CRE)

GreenReserve is a “carbon-backed, cross-chain stablecoin” orchestration system built around **Chainlink Runtime Environment (CRE)**.

The core idea:
- A **CRE workflow** receives a deposit event (HTTP trigger)
- It deterministically queries an **external Reserve/Compliance API** (with consensus aggregation)
- It performs **onchain reads/writes** on **Ethereum Sepolia**
- It sends a **CCIP message** to **Base Sepolia** (destination chain)


## High-level architecture

- **Reserve/Compliance API (Bun)**
  - Deterministic mock API used by the workflow.
  - Endpoints:
    - `GET /health`
    - `GET /reserves?scenario=healthy|unhealthy`
    - `GET /policy/kyc?address=0x...`
    - `POST /deposits` → returns deterministic `depositId`

- **Smart contracts (Foundry)**
  - Sepolia (issuer chain):
    - `GreenReserveTokenA`
    - `GreenReserveIssuer`
    - `GreenReserveCCIPSender`
  - Base Sepolia (destination chain):
    - `GreenReserveTokenB`
    - `GreenReserveReceiver`

- **CRE workflow (TypeScript → WASM)**
  - Path: `workflows/greenreserve-workflow/main.ts`
  - Trigger: HTTP
  - Current behavior:
    - Parse deposit payload
    - Call Reserve API + KYC policy with consensus aggregation
    - Read Sepolia CCIP Router `isChainSupported(destChainSelector)`
    - Mint on Sepolia (if approved and depositId unused)
    - CCIP send to Base Sepolia (if not already processed on destination)

## Networks (current testnet targets)

- **Chain A (Issuer): Ethereum Sepolia**
  - chain-name: `ethereum-testnet-sepolia`
  - chain selector: `16015286601757825753`
  - CCIP router: `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59`

- **Chain B (Destination): Base Sepolia**
  - chain-name: `ethereum-testnet-sepolia-base-1`
  - chain selector: `10344971235874465080`
  - CCIP router: `0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93`

## Deployed contract addresses (current)

These are also recorded in:
- `workflows/greenreserve-workflow/config.staging.json`
- `workflows/greenreserve-workflow/config.production.json`

- Sepolia:
  - TokenA: `0x6bf0a9cfdf9167af8d30e53475752db0dc802b80`
  - Issuer: `0xcdda815db80ea21dad692b469f8d0e27e4853365`
  - Sender: `0xc3ea3c53ed3504f4d527fccac5080249341ab185`
  - CRE Forwarder (EVM write): `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`
  - Issuer Write Receiver (adapter): `0xDe84d37099e43d0e3931Ba16079575Ad8cF19B63`
  - Sender Write Receiver (adapter): `0x79119BA0c58838675B2F45c53bC8685218149D63`
- Base Sepolia:
  - TokenB: `0x20F061Db666A0BC3Fa631C52f8a65DdA287264A1`
  - Receiver: `0x66666fFD3b3595c6a45279e83CfDa770285bF1A7`

## Repository layout

- `contracts/`
  - Solidity contracts + Foundry scripts (`forge build`, `forge script ...`)
- `services/reserve-api/`
  - Bun server providing deterministic reserve + KYC policy endpoints
- `workflows/greenreserve-workflow/`
  - CRE workflow (TypeScript)
  - `workflow.yaml` defines targets (`staging-settings`, `production-settings`)
- `project.yaml`
  - CRE RPC configuration per target

## Prerequisites

- **Bun** (for workflow compilation + reserve-api)
- **Foundry** (for contracts)
- **CRE CLI** (`cre`) installed and available on your `PATH`

## One-time setup (after clone)

### 1) Install Foundry dependencies

This repo uses Foundry git deps under `contracts/lib/`, but **we do not commit** `contracts/lib/` to git (lean repo). You must install them locally:

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
forge install cyfrin/ccip-contracts@1.4.0 --no-commit
```

Then verify:

```bash
forge build
```

### 2) Install Bun dependencies

Reserve API:

```bash
cd services/reserve-api
bun install
```

Workflow:

```bash
cd workflows/greenreserve-workflow
bun install
```

## Run the deterministic Reserve/Compliance API

```bash
cd services/reserve-api
bun run dev
```

Defaults (see `services/reserve-api/.env.example`):
- `PORT=8788`
- `RESERVES_ASOF_TIMESTAMP=1700000000`

Quick checks:

```bash
curl http://127.0.0.1:8788/health
curl "http://127.0.0.1:8788/reserves?scenario=healthy"
curl "http://127.0.0.1:8788/policy/kyc?address=0x0000000000000000000000000000000000000002"
```

## CRE workflow simulation (dry-run)

The workflow folder is `workflows/greenreserve-workflow/`.

The CLI expects a folder path:

```bash
cre workflow simulate ./workflows/greenreserve-workflow \
  -R . \
  -T staging-settings \
  --trigger-index 0 \
  --http-payload @./workflows/greenreserve-workflow/payloads/deposit-allowlisted.json
```

Other payload fixtures:
- `payloads/deposit-blocked.json`
- `payloads/deposit-insufficient-reserves.json`

## CRE workflow simulation (broadcast)

When the workflow starts writing to the EVM (mint + CCIP send), you will run simulation with `--broadcast`.

Create `code/.env` (this file is gitignored) with a funded key:

```bash
CRE_ETH_PRIVATE_KEY=0x...
```

Then:

```bash
cre workflow simulate ./workflows/greenreserve-workflow \
  -R . \
  -T staging-settings \
  --trigger-index 0 \
  --http-payload @./workflows/greenreserve-workflow/payloads/deposit-allowlisted.json \
  --broadcast
```

Notes:
- `sepoliaWriteGasLimit` (in `workflows/greenreserve-workflow/config.staging.json`) controls the gas limit used for CRE EVM `writeReport` transactions. This matters because the forwarder executes the adapter and then the target contract logic (including the nested CCIP send).
- CCIP execution on Base Sepolia is asynchronous. A successful Sepolia send only proves the message was accepted for routing; the destination chain state may update a bit later.
- The workflow prints diagnostic logs after a successful send to help track delivery:
  - `ccip_sender_config ...` (onchain sender config: router, destination chain selector, destination receiver, operator, gas limit)
  - `ccip_messageId_from_receipt=...` (or `ccip_messageId_from_scan=...` fallback)
  - `base_messageReceived ...` (destination receiver event)
  - `base_routerMessageExecuted ...` (destination router execution evidence)

Note: the Sepolia CCIP sender contract pays CCIP fees from its own ETH balance. Before running `--broadcast`, make sure the deployed `GreenReserveCCIPSender` address is funded with some Sepolia ETH.

## Contract deployment (Foundry)

### Environment variables

See `contracts/.env.example`:
- `PRIVATE_KEY` (deployer)
- `BASE_RECEIVER` (used when deploying Sepolia sender/issuer)
- `WORKFLOW_OPERATOR` (optional; set Issuer/Sender operator to the CRE workflow signer address)
- `SEPOLIA_SENDER` (used when allowlisting sender on Base Sepolia receiver)
- `CCIP_GAS_LIMIT` (optional)

### Deploy Base Sepolia (TokenB + Receiver)

```bash
cd contracts
export PRIVATE_KEY=0x...
forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url https://sepolia.base.org \
  --broadcast -vvvv
```

### Deploy Sepolia (TokenA + Issuer + Sender)

```bash
cd contracts
export PRIVATE_KEY=0x...
export BASE_RECEIVER=0x...
export WORKFLOW_OPERATOR=0x... # optional, defaults to deployer
forge script script/DeploySepolia.s.sol:DeploySepolia \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast -vvvv
```

### Deploy Sepolia CRE write receiver adapters (Issuer + Sender)

The CRE EVM Write Forwarder expects the receiver contract to implement `onReport(...)`. This repo uses `CREReportReceiverAdapter` as a thin receiver that forwards the call into the real target contract (`GreenReserveIssuer` / `GreenReserveCCIPSender`).

Deploy the adapters:

```bash
cd contracts
export PRIVATE_KEY=0x...
export CRE_FORWARDER=0x15fC6ae953E024d975e77382eEeC56A9101f9F88
export ISSUER=0x...
export SENDER=0x...
forge script script/DeploySepoliaAdapters.s.sol:DeploySepoliaAdapters \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --broadcast -vvvv
```

Then update Issuer/Sender operators to the adapter addresses (required because the adapter becomes `msg.sender` when calling the target contracts):

```bash
cast send <SEPOLIA_ISSUER_ADDRESS> \
  "setOperator(address)" <ISSUER_ADAPTER_ADDRESS> \
  --private-key $PRIVATE_KEY \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com

cast send <SEPOLIA_SENDER_ADDRESS> \
  "setOperator(address)" <SENDER_ADAPTER_ADDRESS> \
  --private-key $PRIVATE_KEY \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

Finally, set these addresses in the workflow config:
- `sepoliaIssuerWriteReceiverAddress` = issuer adapter address
- `sepoliaSenderWriteReceiverAddress` = sender adapter address

### Fund Sepolia sender with ETH (for CCIP fees)

`GreenReserveCCIPSender.send(...)` pays CCIP fees from the contract balance (not `msg.value`). Send some Sepolia ETH to the deployed sender address:

```bash
cast send <SEPOLIA_SENDER_ADDRESS> \
  --value 0.01ether \
  --private-key $PRIVATE_KEY \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

### Allowlist Sepolia sender on Base Sepolia receiver

```bash
cd contracts
export PRIVATE_KEY=0x...
export BASE_RECEIVER=0x...
export SEPOLIA_SENDER=0x...
forge script script/ConfigureBaseSepoliaReceiver.s.sol:ConfigureBaseSepoliaReceiver \
  --rpc-url https://sepolia.base.org \
  --broadcast -vvvv
```

