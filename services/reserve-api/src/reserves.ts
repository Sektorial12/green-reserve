import { hashMessage, recoverAddress } from "viem"

type ReserveAttestation = {
  asOfTimestamp: number
  totalReservesUsd: string
  totalLiabilitiesUsd: string
  reserveRatioBps: string
  proofRef: string
  auditor: string
  signature: string
}

type ReservesState = {
  asOfTimestamp: number
  totalReservesUsd: string
  totalLiabilitiesUsd: string
  reserveRatioBps: string
  proofRef: string
  auditor: string
  signature: string
  message: string
  messageHash: string
}

let cache:
  | {
      loadedAtMs: number
      state: ReservesState
    }
  | null = null

const makeAttestationMessage = (a: Omit<ReserveAttestation, "signature">): string => {
  return [
    "GreenReserveReserveAttestation:v1",
    `asOfTimestamp=${a.asOfTimestamp}`,
    `totalReservesUsd=${a.totalReservesUsd}`,
    `totalLiabilitiesUsd=${a.totalLiabilitiesUsd}`,
    `reserveRatioBps=${a.reserveRatioBps}`,
    `proofRef=${a.proofRef}`,
    `auditor=${a.auditor.toLowerCase()}`,
  ].join("\n")
}

const readJsonFile = async (path: string): Promise<string> => {
  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) throw new Error(`reserve_attestation_file_not_found path=${path}`)
  return await file.text()
}

const validateAttestation = (raw: any): ReserveAttestation => {
  if (!raw || typeof raw !== "object") throw new Error("invalid_attestation_json")

  const asOfTimestamp = raw.asOfTimestamp
  const totalReservesUsd = raw.totalReservesUsd
  const totalLiabilitiesUsd = raw.totalLiabilitiesUsd
  const reserveRatioBps = raw.reserveRatioBps
  const proofRef = raw.proofRef
  const auditor = raw.auditor
  const signature = raw.signature

  if (!Number.isInteger(asOfTimestamp) || asOfTimestamp <= 0) throw new Error("invalid_asOfTimestamp")
  if (typeof totalReservesUsd !== "string" || !/^[0-9]+$/.test(totalReservesUsd)) throw new Error("invalid_totalReservesUsd")
  if (typeof totalLiabilitiesUsd !== "string" || !/^[0-9]+$/.test(totalLiabilitiesUsd)) throw new Error("invalid_totalLiabilitiesUsd")
  if (typeof reserveRatioBps !== "string" || !/^[0-9]+$/.test(reserveRatioBps)) throw new Error("invalid_reserveRatioBps")
  if (typeof proofRef !== "string" || proofRef.length === 0) throw new Error("invalid_proofRef")
  if (typeof auditor !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(auditor)) throw new Error("invalid_auditor")
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("invalid_signature")

  return {
    asOfTimestamp,
    totalReservesUsd,
    totalLiabilitiesUsd,
    reserveRatioBps,
    proofRef,
    auditor,
    signature,
  }
}

export const loadReservesState = async (): Promise<ReservesState> => {
  const ttlSec = Number.parseInt(Bun.env.RESERVES_CACHE_TTL_SEC ?? "30", 10)
  const ttlMs = Number.isFinite(ttlSec) ? ttlSec * 1000 : 30 * 1000

  if (cache && Date.now() - cache.loadedAtMs < ttlMs) {
    return cache.state
  }

  const path = Bun.env.RESERVE_ATTESTATION_PATH
  if (!path) throw new Error("missing_RESERVE_ATTESTATION_PATH")

  const text = await readJsonFile(path)
  const parsed = JSON.parse(text)
  const att = validateAttestation(parsed)

  const expectedAuditor = (Bun.env.AUDITOR_ADDRESS ?? "").toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(expectedAuditor)) throw new Error("missing_or_invalid_AUDITOR_ADDRESS")

  if (att.auditor.toLowerCase() !== expectedAuditor) {
    throw new Error(`auditor_mismatch attestor=${att.auditor} expected=${expectedAuditor}`)
  }

  const message = makeAttestationMessage({
    asOfTimestamp: att.asOfTimestamp,
    totalReservesUsd: att.totalReservesUsd,
    totalLiabilitiesUsd: att.totalLiabilitiesUsd,
    reserveRatioBps: att.reserveRatioBps,
    proofRef: att.proofRef,
    auditor: att.auditor,
  })

  const messageHash = hashMessage(message)
  const recovered = await recoverAddress({ hash: messageHash, signature: att.signature as any })
  if (recovered.toLowerCase() !== expectedAuditor) {
    throw new Error(`invalid_attestation_signature recovered=${recovered} expected=${expectedAuditor}`)
  }

  const state: ReservesState = {
    asOfTimestamp: att.asOfTimestamp,
    totalReservesUsd: att.totalReservesUsd,
    totalLiabilitiesUsd: att.totalLiabilitiesUsd,
    reserveRatioBps: att.reserveRatioBps,
    proofRef: att.proofRef,
    auditor: att.auditor,
    signature: att.signature,
    message,
    messageHash,
  }

  cache = { loadedAtMs: Date.now(), state }
  return state
}
