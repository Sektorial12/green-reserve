import { ensureSanctionsLoaded, getSanctionsLoadState, getSanctionsMeta, screenAddressAgainstSanctions } from "./sanctions"
import { generateRiskMemo } from "./ai"
import { loadReservesState } from "./reserves"
import { hashMessage, recoverAddress } from "viem"

const corsHeaders = (req?: Request): HeadersInit => {
  const origin = req?.headers.get("origin") ?? "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
};

const json = (value: unknown, init?: ResponseInit, req?: Request) => {
  return new Response(JSON.stringify(value), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(req),
      ...(init?.headers ?? {}),
    },
  });
};

const isHexAddress = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(a)

const normalizeAddress = (a: string): string => a.toLowerCase()

ensureSanctionsLoaded().catch(() => {})

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

type DepositNotice = {
  version: string
  custodian: string
  asset?: {
    type?: string
    registry?: string
    projectId?: string
  }
  fiat?: {
    currency?: string
    amount?: string
  }
  onchain: {
    to: string
    chain: string
  }
  amountWei: string
  timestamp: number
  evidenceUrl?: string
}

const isHexBytes32 = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s)

const parseDepositNotice = (raw: any): DepositNotice => {
  if (!raw || typeof raw !== "object") throw new Error("invalid_notice")
  if (typeof raw.version !== "string" || raw.version.length === 0) throw new Error("invalid_version")
  if (raw.version !== "1" && raw.version !== "2") throw new Error("invalid_version")
  if (typeof raw.custodian !== "string" || raw.custodian.length === 0) throw new Error("invalid_custodian")

  if (raw.version === "1") {
    if (raw.asset !== undefined) throw new Error("invalid_asset")
    if (raw.fiat !== undefined) throw new Error("invalid_fiat")
    if (raw.evidenceUrl !== undefined) throw new Error("invalid_evidenceUrl")
  }

  if (raw.asset !== undefined) {
    if (!raw.asset || typeof raw.asset !== "object") throw new Error("invalid_asset")
    if (raw.asset.type !== undefined && typeof raw.asset.type !== "string") throw new Error("invalid_asset_type")
    if (raw.asset.registry !== undefined && typeof raw.asset.registry !== "string") throw new Error("invalid_asset_registry")
    if (raw.asset.projectId !== undefined && typeof raw.asset.projectId !== "string") throw new Error("invalid_asset_projectId")
  }
  if (raw.fiat !== undefined) {
    if (!raw.fiat || typeof raw.fiat !== "object") throw new Error("invalid_fiat")
    if (raw.fiat.currency !== undefined && typeof raw.fiat.currency !== "string") throw new Error("invalid_fiat_currency")
    if (raw.fiat.amount !== undefined && typeof raw.fiat.amount !== "string") throw new Error("invalid_fiat_amount")
  }

  if (!raw.onchain || typeof raw.onchain !== "object") throw new Error("invalid_onchain")
  if (typeof raw.onchain.to !== "string" || !isHexAddress(raw.onchain.to.toLowerCase())) throw new Error("invalid_to")
  if (typeof raw.onchain.chain !== "string" || raw.onchain.chain.length === 0) throw new Error("invalid_chain")
  if (typeof raw.amountWei !== "string" || !/^[0-9]+$/.test(raw.amountWei)) throw new Error("invalid_amountWei")
  if (!Number.isInteger(raw.timestamp) || raw.timestamp <= 0) throw new Error("invalid_timestamp")
  if (raw.evidenceUrl !== undefined && typeof raw.evidenceUrl !== "string") throw new Error("invalid_evidenceUrl")
  return {
    version: raw.version,
    custodian: raw.custodian,
    asset: raw.asset,
    fiat: raw.fiat,
    onchain: { to: raw.onchain.to.toLowerCase(), chain: raw.onchain.chain },
    amountWei: raw.amountWei,
    timestamp: raw.timestamp,
    evidenceUrl: raw.evidenceUrl,
  }
}

const makeDepositNoticeMessage = (n: DepositNotice, custodianAddress: string): string => {
  const isV2 = n.version === "2"
  return [
    isV2 ? "GreenReserveDepositNotice:v2" : "GreenReserveDepositNotice:v1",
    `version=${n.version}`,
    `custodian=${n.custodian}`,
    `to=${n.onchain.to.toLowerCase()}`,
    `chain=${n.onchain.chain}`,
    `amountWei=${n.amountWei}`,
    `timestamp=${n.timestamp}`,
    `custodianAddress=${custodianAddress.toLowerCase()}`,
    ...(isV2
      ? [
          `assetType=${String(n.asset?.type ?? "")}`,
          `assetRegistry=${String(n.asset?.registry ?? "")}`,
          `assetProjectId=${String(n.asset?.projectId ?? "")}`,
          `fiatCurrency=${String(n.fiat?.currency ?? "")}`,
          `fiatAmount=${String(n.fiat?.amount ?? "")}`,
          `evidenceUrl=${String(n.evidenceUrl ?? "")}`,
        ]
      : []),
  ].join("\n")
}

const seenDeposits = new Map<string, any>()

const depositsDbPath = Bun.env.DEPOSITS_DB_PATH ?? ""
let depositsLoaded = false

const ensureDepositsLoaded = async () => {
  if (depositsLoaded) return
  depositsLoaded = true

  if (!depositsDbPath) return
  const file = Bun.file(depositsDbPath)
  const exists = await file.exists()
  if (!exists) return

  const text = await file.text()
  if (!text.trim()) return

  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error("invalid_deposits_db")
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue
    const depositId = String((row as any).depositId ?? "")
    if (!isHexBytes32(depositId)) continue
    seenDeposits.set(depositId, {
      notice: (row as any).notice,
      custodianAddress: (row as any).custodianAddress,
      signature: (row as any).signature,
      messageHash: (row as any).messageHash,
    })
  }
}

const persistDeposits = async () => {
  if (!depositsDbPath) return
  const rows = Array.from(seenDeposits.entries()).map(([depositId, item]) => ({ depositId, ...item }))
  await Bun.write(depositsDbPath, JSON.stringify(rows, null, 2) + "\n")
}

Bun.serve({
  port: Number(Bun.env.PORT ?? 8788),
  idleTimeout: 120,
  fetch: async (req) => {
    const url = new URL(req.url)

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true }, undefined, req)
    }

    if (req.method === "GET" && url.pathname === "/sanctions/meta") {
      const meta = getSanctionsMeta()
      if (!meta) {
        ensureSanctionsLoaded().catch(() => {})
        const state = getSanctionsLoadState()
        const msg =
          state.lists.ofac_sdn_advanced.lastError ??
          state.lists.eu_consolidated.lastError ??
          state.lists.uk_sanctions_list.lastError ??
          "sanctions_not_loaded"
        return json(
          { error: "sanctions_unavailable", message: msg },
          { status: 503 },
          req,
        )
      }
      return json({ ok: true, ...meta }, undefined, req)
    }

    if (req.method === "GET" && url.pathname === "/reserves") {
      try {
        const state = await loadReservesState()
        return json(
          {
            asOfTimestamp: state.asOfTimestamp,
            totalReservesUsd: state.totalReservesUsd,
            totalLiabilitiesUsd: state.totalLiabilitiesUsd,
            reserveRatioBps: state.reserveRatioBps,
            proofRef: state.proofRef,
            auditor: state.auditor,
            signature: state.signature,
            messageHash: state.messageHash,
          },
          undefined,
          req,
        )
      } catch (e) {
        return json({ error: "reserves_unavailable", message: (e as Error).message }, { status: 503 }, req)
      }
    }

    if (req.method === "GET" && url.pathname === "/policy/kyc") {
      const address = url.searchParams.get("address") ?? ""
      const normalized = normalizeAddress(address)
      if (!isHexAddress(normalized)) {
        return json({ address: normalized, isAllowed: false, reason: "invalid_address" }, undefined, req)
      }

      if (!getSanctionsMeta()) {
        ensureSanctionsLoaded().catch(() => {})
        const state = getSanctionsLoadState()
        const msg =
          state.lists.ofac_sdn_advanced.lastError ??
          state.lists.eu_consolidated.lastError ??
          state.lists.uk_sanctions_list.lastError ??
          "sanctions_not_loaded"
        return json(
          { error: "sanctions_unavailable", message: msg },
          { status: 503 },
          req,
        )
      }

      const decision = screenAddressAgainstSanctions(normalized)
      return json({ address: normalized, ...decision }, undefined, req)
    }

    if (req.method === "GET" && url.pathname === "/ai/risk-memo") {
      const depositId = url.searchParams.get("depositId") ?? ""
      const to = normalizeAddress(url.searchParams.get("to") ?? "")
      const amount = url.searchParams.get("amount") ?? ""
      const reserveRatioBps = url.searchParams.get("reserveRatioBps") ?? ""
      const kycAllowed = url.searchParams.get("kycAllowed")
      const kycReason = url.searchParams.get("kycReason") ?? ""

      if (!depositId.startsWith("0x") || depositId.length !== 66) {
        return json({ error: "invalid_depositId" }, { status: 400 }, req)
      }
      if (!isHexAddress(to)) {
        return json({ error: "invalid_to" }, { status: 400 }, req)
      }
      if (!/^[0-9]+$/.test(amount)) {
        return json({ error: "invalid_amount" }, { status: 400 }, req)
      }
      if (!/^[0-9]+$/.test(reserveRatioBps)) {
        return json({ error: "invalid_reserveRatioBps" }, { status: 400 }, req)
      }
      if (kycAllowed !== null && kycAllowed !== "true" && kycAllowed !== "false") {
        return json({ error: "invalid_kycAllowed" }, { status: 400 }, req)
      }

      const input = {
        depositId,
        to,
        amount,
        reserveRatioBps,
        kyc: {
          isAllowed: kycAllowed === null ? null : kycAllowed === "true",
          reason: kycReason,
        },
      }

      try {
        const result = await generateRiskMemo(input)
        return json(
          {
            ok: true,
            model: result.model,
            promptVersion: result.promptVersion ?? null,
            inputSha256: result.inputSha256,
            memo: result.memo,
            memoSha256: result.memoSha256,
            external: result.external ?? null,
          },
          undefined,
          req,
        )
      } catch (e) {
        return json({ error: "ai_unavailable", message: (e as Error).message }, { status: 503 }, req)
      }
    }

    if (req.method === "POST" && url.pathname === "/ai/risk-memo") {
      let body: any = null
      try {
        body = await req.json()
      } catch {
        return json({ error: "invalid_json" }, { status: 400 }, req)
      }

      try {
        const result = await generateRiskMemo(body)
        return json(
          {
            ok: true,
            model: result.model,
            promptVersion: result.promptVersion ?? null,
            inputSha256: result.inputSha256,
            memo: result.memo,
            memoSha256: result.memoSha256,
            external: result.external ?? null,
          },
          undefined,
          req,
        )
      } catch (e) {
        return json({ error: "ai_unavailable", message: (e as Error).message }, { status: 503 }, req)
      }
    }

    if (req.method === "GET" && url.pathname === "/deposits") {
      try {
        await ensureDepositsLoaded()
      } catch (e) {
        return json({ error: "deposits_unavailable", message: (e as Error).message }, { status: 503 }, req)
      }

      const depositId = url.searchParams.get("depositId") ?? ""
      if (!isHexBytes32(depositId)) {
        return json({ error: "invalid_depositId" }, { status: 400 }, req)
      }

      const item = seenDeposits.get(depositId)
      if (!item) {
        return json({ error: "not_found" }, { status: 404 }, req)
      }

      return json(
        {
          ok: true,
          depositId,
          notice: item.notice,
          custodianAddress: item.custodianAddress,
          messageHash: item.messageHash,
          signature: item.signature ?? null,
          hasSignature: Boolean(item.signature),
        },
        undefined,
        req,
      )
    }

    if (req.method === "POST" && url.pathname === "/deposits") {
      try {
        await ensureDepositsLoaded()
      } catch (e) {
        return json({ error: "deposits_unavailable", message: (e as Error).message }, { status: 503 }, req)
      }

      let body: any = null
      try {
        body = await req.json()
      } catch {
        return json({ error: "invalid_json" }, { status: 400 }, req)
      }

      const requireSig = (Bun.env.DEPOSIT_REQUIRE_SIGNATURE ?? "1") !== "0"

      const noticeRaw = body?.notice ?? body
      const notice = (() => {
        try {
          return parseDepositNotice(noticeRaw)
        } catch (e) {
          return null
        }
      })()
      if (!notice) {
        return json({ error: "invalid_notice" }, { status: 400 }, req)
      }

      const custodianAddress = String(body?.custodianAddress ?? "").toLowerCase()
      if (!isHexAddress(custodianAddress)) {
        return json({ error: "invalid_custodianAddress" }, { status: 400 }, req)
      }

      const expectedCustodian = (Bun.env.DEPOSIT_CUSTODIAN_ADDRESS ?? "").toLowerCase()
      if (expectedCustodian && isHexAddress(expectedCustodian) && expectedCustodian !== custodianAddress) {
        return json({ error: "custodian_not_allowed" }, { status: 403 }, req)
      }

      const signature = String(body?.signature ?? "")
      if (requireSig) {
        if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
          return json({ error: "invalid_signature" }, { status: 400 }, req)
        }
      }

      const message = makeDepositNoticeMessage(notice, custodianAddress)
      const messageHash = hashMessage(message)

      if (requireSig) {
        let recovered: string
        try {
          recovered = await recoverAddress({ hash: messageHash, signature: signature as any })
        } catch (e) {
          return json({ error: "invalid_signature" }, { status: 400 }, req)
        }
        if (recovered.toLowerCase() !== custodianAddress) {
          return json({ error: "invalid_signature" }, { status: 400 }, req)
        }
      }

      const depositId = `0x${await sha256Hex(message)}`
      if (!isHexBytes32(depositId)) {
        return json({ error: "depositId_generation_failed" }, { status: 500 }, req)
      }

      if (!seenDeposits.has(depositId)) {
        seenDeposits.set(depositId, {
          notice,
          custodianAddress,
          signature: requireSig ? signature : null,
          messageHash,
        })

        try {
          await persistDeposits()
        } catch (e) {
          return json({ error: "deposits_persist_failed", message: (e as Error).message }, { status: 503 }, req)
        }
      }

      return json({ depositId, custodianAddress, messageHash }, undefined, req)
    }

    return json({ error: "not_found" }, { status: 404 }, req)
  },
})
