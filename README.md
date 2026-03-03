# GreenReserve (Chainlink CRE)

GreenReserve is a “carbon-backed, cross-chain stablecoin” orchestration system built around **Chainlink Runtime Environment (CRE)**.

The core idea:
- A **CRE workflow** receives a deposit event (HTTP trigger)
- It deterministically queries an **external Reserve/Compliance API** (with consensus aggregation)
- It performs **onchain reads/writes** on **Ethereum Sepolia**
- It sends a **CCIP message** to **Base Sepolia** (destination chain)

## Status

This repository is intended as a developer-facing reference implementation and demo environment.


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

## Quickstart (local)

GreenReserve has multiple components. For most local development and frontend testing you will typically run:

- The deterministic Reserve/Compliance API (Bun)
- The frontend (Next.js)

### Prerequisites

- **Node.js + npm** (frontend)
- **Bun** (Reserve/Compliance API)

Optional (for deeper development):

- **Foundry** (smart contracts)
- **CRE CLI** (`cre`) for workflow simulation/broadcast

## Frontend (Next.js)

### 1) Install dependencies

```bash
cd frontend
npm install
```

### 2) Configure environment variables

Copy the example env file:

```bash
cp .env.example .env.local
```

Minimum recommended settings for local dev:

- `NEXT_PUBLIC_RESERVE_API_BASE_URL=http://127.0.0.1:8788`

If you want to test real wallet connections, you will typically need:

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...`

Optional observability:

- `NEXT_PUBLIC_SENTRY_DSN=`
- `NEXT_PUBLIC_POSTHOG_KEY=`

### 3) Start dev server

```bash
npm run dev
```

Open:

- `http://localhost:3000`

### Common commands

```bash
npm run lint
npm run build
npm test
```

### E2E tests (Playwright)

Start an E2E production server (build + start on port `3005` with E2E flags enabled):

```bash
npm run e2e:server
```

Then in a second terminal:

```bash
npm run e2e
```

UI mode:

```bash
npm run e2e:ui
```

### Lighthouse performance budget

```bash
npm run lighthouse:budget
```

## Reserve/Compliance API (Bun)

### Install and run

```bash
cd services/reserve-api
bun install
bun run dev
```

Quick checks:

```bash
curl http://127.0.0.1:8788/health
curl "http://127.0.0.1:8788/reserves?scenario=healthy"
curl "http://127.0.0.1:8788/policy/kyc?address=0x0000000000000000000000000000000000000002"
```

## Smart contracts (Foundry)

If you are working on Solidity and deployments:

```bash
cd contracts
forge build
```

## CRE workflow (advanced)

Workflow development and on-chain broadcast requires the `cre` CLI and testnet funding.

For simulation and demo scripts, see the `scripts/` directory.

## Contract deployment (Foundry) (advanced)

Contract code and deployment scripts live in `contracts/`.

Typical workflow:

```bash
cd contracts
forge build
```

To deploy to testnets, use the Foundry scripts under `contracts/script/` with `--broadcast`.

Environment variables are read from your local shell or `.env` files. Never commit private keys.
