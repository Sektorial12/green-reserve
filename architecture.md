# GreenReserve Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    Operator / User                                  │
│                                                                                     │
│   ┌───────────────┐                                                                 │
│   │  CLI (Node)   │                                                                 │
│   │ deposit create│──────────────────────────────────────────────────────┐          │
│   │ deposit submit│──────────────────────────────────────────────────────┼──────┐   │
│   │ deposit status│──────────────────────────────────────────────────────┼──────┼───┤
│   │ doctor        │                                                      │      │   │
│   └───────────────┘                                                      │      │   │
└──────────────────────────────────────────────────────────────────────────┼──────┼───┘
                                                                           │      │
                                                                           ▼      │
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  Reserve API (Bun)                                  │
│                                                                                     │
│   GET /reserves           ─ signed reserve attestation                              │
│   GET /deposits           ─ deposit notice by ID                                    │
│   POST /deposits          ─ create deposit notice                                   │
│   GET /policy/kyc         ─ compliance / sanctions check                            │
│   GET /ai/risk-memo       ─ AI risk memo (Gemini or fallback)                       │
│   GET /health             ─ health check                                            │
│   GET /sanctions/meta     ─ sanctions list metadata                                 │
│                                                                                     │
└──────────────────────────────────────────────────────────────────────────┬──────────┘
                                                                           │
                                                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         CRE Workflow (greenreserve-workflow)                        │
│                                                                                     │
│   HTTP Trigger ──► Fetch deposit notice + reserves + KYC + AI memo                  │
│                          │                                                          │
│                          ▼                                                          │
│                    Validate signatures & hashes                                     │
│                          │                                                          │
│                          ▼                                                          │
│                    Write audit record (Sepolia AuditRegistry)                       │
│                          │                                                          │
│                          ▼                                                          │
│                    Mint on Sepolia (Issuer.mint)                                    │
│                          │                                                          │
│                          ▼                                                          │
│                    CCIP Send (Sender.send ──► CCIP Router)                          │
│                                                                                     │
└──────────────────────────────────────────────────────────────────────────┬──────────┘
                                                                           │
                                                                           │ CCIP
                                                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              On-Chain Contracts                                     │
│                                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                           Sepolia (Source Chain)                            │   │
│   │                                                                             │   │
│   │   GreenReserveTokenA       ─ ERC-20 token (mintable by Issuer)              │   │
│   │   GreenReserveIssuer       ─ mints TokenA, records usedDepositId            │   │
│   │   GreenReserveCCIPSender   ─ validates audit, calls CCIP router             │   │
│   │   GreenReserveAuditRegistry─ stores audit hashes per depositId              │   │
│   │   WriteReceiverAdapter(s)  ─ CRE write adapters for each contract           │   │
│   │                                                                             │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
│                                       │ CCIP                                        │
│                                       ▼                                             │
│   ┌─────────────────────────────────────────────────────────────────────────────┐   │
│   │                       Base Sepolia (Destination Chain)                      │   │
│   │                                                                             │   │
│   │   GreenReserveTokenB       ─ ERC-20 token (mintable by Receiver)            │   │
│   │   GreenReserveReceiver     ─ CCIPReceiver, mints TokenB on message receipt  │   │
│   │                                                                             │   │
│   └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### CLI (`cli/`)
TypeScript CLI built with `commander`. Commands:
- **doctor** – validates environment, contract linkages, and funding
- **deposit create** – creates and signs a deposit notice via Reserve API
- **deposit submit** – triggers CRE workflow simulation/broadcast
- **deposit status** – queries on-chain state, decodes CCIP `MessageSent`, watches destination

### Reserve API (`services/reserve-api/`)
Bun HTTP service providing:
- Signed reserve attestation (`GET /reserves`)
- Deposit notice CRUD (`GET/POST /deposits`)
- Compliance/KYC policy (`GET /policy/kyc`)
- AI risk memo (`GET /ai/risk-memo`) – calls Gemini or uses deterministic fallback
- Sanctions list metadata (`GET /sanctions/meta`)

### CRE Workflow (`workflows/greenreserve-workflow/`)
Chainlink Runtime Environment workflow:
1. Receives HTTP trigger with `depositId` and `scenario`
2. Fetches deposit notice, reserve attestation, KYC, AI memo from Reserve API
3. Validates signatures and hashes
4. Writes audit record to Sepolia `AuditRegistry`
5. Mints on Sepolia via `Issuer.mint`
6. Sends cross-chain via `Sender.send` → CCIP Router

### Contracts (`contracts/`)
Foundry project with:
- **Sepolia contracts**
  - `GreenReserveTokenA` – ERC-20
  - `GreenReserveIssuer` – mints TokenA, tracks `usedDepositId`
  - `GreenReserveCCIPSender` – validates audit, calls `router.ccipSend`
  - `GreenReserveAuditRegistry` – stores audit hashes
  - `WriteReceiverAdapter` – CRE write adapters
- **Base Sepolia contracts**
  - `GreenReserveTokenB` – ERC-20
  - `GreenReserveReceiver` – extends `CCIPReceiver`, mints TokenB

## Data Flow

1. **Deposit Creation**
   - Operator calls `deposit create` → Reserve API stores notice, returns `depositId`

2. **Deposit Submission**
   - Operator calls `deposit submit` → CRE workflow runs
   - Workflow fetches context from Reserve API
   - Workflow writes audit, mints, sends CCIP

3. **Cross-Chain Delivery**
   - CCIP Router delivers message to Base Sepolia
   - `GreenReserveReceiver.ccipReceive` mints TokenB to recipient

4. **Status Verification**
   - Operator calls `deposit status` → CLI queries on-chain state
   - Decodes `MessageSent` event from Sepolia tx
   - Watches `processedDepositId` on Base Sepolia

## Security Model

- **Audit trail**: All evidence hashes committed on-chain before mint/send
- **Idempotency**: `usedDepositId` (Sepolia) and `processedDepositId` (Base Sepolia) prevent replay
- **Allowlisting**: Receiver allowlists source chain + sender address
- **Failed message handling**: Receiver stores failed messages for retry/resolve

## Network Configuration

| Chain | Selector | CCIP Router |
|-------|----------|-------------|
| Sepolia | `16015286601757825753` | `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59` |
| Base Sepolia | `10344971235874465080` | `0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93` |
