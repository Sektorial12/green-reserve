import { privateKeyToAccount } from "viem/accounts"

const getArg = (name: string): string | null => {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return null
  return process.argv[idx + 1] ?? null
}

const reqArg = (name: string): string => {
  const v = getArg(name)
  if (!v) throw new Error(`missing_arg ${name}`)
  return v
}

const makeMessage = (a: {
  asOfTimestamp: number
  totalReservesUsd: string
  totalLiabilitiesUsd: string
  reserveRatioBps: string
  proofRef: string
  auditor: string
}): string => {
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

const parseBigIntString = (s: string, field: string): bigint => {
  if (!/^[0-9]+$/.test(s)) throw new Error(`invalid_${field}`)
  return BigInt(s)
}

const main = async () => {
  const totalReservesUsdStr = reqArg("--reserves-usd")
  const totalLiabilitiesUsdStr = reqArg("--liabilities-usd")
  const proofRef = reqArg("--proof-ref")

  const asOf = getArg("--as-of")
  const asOfTimestamp = asOf ? Number.parseInt(asOf, 10) : Math.floor(Date.now() / 1000)
  if (!Number.isFinite(asOfTimestamp) || asOfTimestamp <= 0) throw new Error("invalid_asOfTimestamp")

  const pk = (Bun.env.AUDITOR_PRIVATE_KEY ?? getArg("--auditor-private-key") ?? "").trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("missing_or_invalid_AUDITOR_PRIVATE_KEY")

  const reserves = parseBigIntString(totalReservesUsdStr, "totalReservesUsd")
  const liabilities = parseBigIntString(totalLiabilitiesUsdStr, "totalLiabilitiesUsd")
  if (liabilities === 0n) throw new Error("invalid_totalLiabilitiesUsd")

  const reserveRatioBps = ((reserves * 10_000n) / liabilities).toString()

  const account = privateKeyToAccount(pk as `0x${string}`)
  const auditor = account.address

  const message = makeMessage({
    asOfTimestamp,
    totalReservesUsd: totalReservesUsdStr,
    totalLiabilitiesUsd: totalLiabilitiesUsdStr,
    reserveRatioBps,
    proofRef,
    auditor,
  })

  const signature = await account.signMessage({ message })

  const out = {
    asOfTimestamp,
    totalReservesUsd: totalReservesUsdStr,
    totalLiabilitiesUsd: totalLiabilitiesUsdStr,
    reserveRatioBps,
    proofRef,
    auditor,
    signature,
  }

  process.stdout.write(JSON.stringify(out, null, 2) + "\n")
}

main().catch((e) => {
  process.stderr.write(String((e as Error).message ?? e) + "\n")
  process.exit(1)
})
