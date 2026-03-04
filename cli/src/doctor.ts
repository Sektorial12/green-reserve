import { createPublicClient, http, parseAbi } from "viem"
import { asUrlBase, fmtBool, httpGetJson, isHexAddress, lower } from "./util"
import { defaultWorkflowConfigPath, readWorkflowConfig } from "./config"

const ISSUER_ABI = parseAbi(["function operator() view returns (address)"])
const SENDER_ABI = parseAbi([
  "function operator() view returns (address)",
  "function estimateFee(address to, uint256 amount, bytes32 depositId) view returns (uint256)",
])
const AUDIT_REGISTRY_ABI = parseAbi(["function operator() view returns (address)"])

const RECEIVER_ABI = parseAbi([
  "function allowlistedSourceChains(uint64 chainSelector) view returns (bool)",
  "function allowlistedSenders(address sender) view returns (bool)",
])

const SEPOLIA_CHAIN_SELECTOR_ON_BASE = 16015286601757825753n
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000"

export const runDoctor = async (opts: {
  json?: boolean
  configFile?: string
  reserveApiBaseUrl?: string
  sepoliaRpc?: string
  baseRpc?: string
  crePath?: string
}) => {
  const configPath = opts.configFile ?? defaultWorkflowConfigPath()
  const cfg = await readWorkflowConfig(configPath)

  const baseUrl = asUrlBase(opts.reserveApiBaseUrl ?? process.env.RESERVE_API_BASE_URL ?? cfg.reserveApiBaseUrl)
  const sepoliaRpc = opts.sepoliaRpc ?? process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com"
  const baseRpc = opts.baseRpc ?? process.env.BASE_RPC ?? "https://sepolia.base.org"

  const failures: string[] = []
  let sanctionsMeta: any = null

  const crePath = opts.crePath ?? process.env.CRE_CLI_PATH ?? Bun.which("cre") ?? ""
  if (!crePath) failures.push("missing_cre_cli")

  try {
    const health = await httpGetJson<{ ok: boolean }>(`${baseUrl}/health`)
    if (!health.ok) failures.push("reserve_api_health_not_ok")
  } catch (e) {
    failures.push(`reserve_api_unreachable ${(e as Error).message}`)
  }

  try {
    const maxWaitMs = Number.parseInt(process.env.DOCTOR_SANCTIONS_WAIT_MS ?? "180000", 10)
    const start = Date.now()
    let lastErr: Error | null = null
    while (true) {
      try {
        const meta = await httpGetJson<any>(`${baseUrl}/sanctions/meta`)
        if (!meta?.ok) {
          lastErr = new Error("sanctions_meta_not_ok")
        } else {
          sanctionsMeta = meta
          break
        }
      } catch (e) {
        lastErr = e as Error
      }

      if (Date.now() - start >= (Number.isFinite(maxWaitMs) ? maxWaitMs : 60000)) {
        throw lastErr ?? new Error("sanctions_unavailable")
      }

      await new Promise((r) => setTimeout(r, 2000))
    }
  } catch (e) {
    failures.push(`sanctions_unavailable ${(e as Error).message}`)
  }

  try {
    const reserves = await httpGetJson<any>(`${baseUrl}/reserves`)
    if (!reserves?.reserveRatioBps) failures.push("reserves_missing_reserveRatioBps")
  } catch (e) {
    failures.push(`reserves_unavailable ${(e as Error).message}`)
  }

  const issuer = cfg.sepoliaIssuerAddress ?? ""
  const issuerWr = cfg.sepoliaIssuerWriteReceiverAddress ?? ""
  const sender = cfg.sepoliaSenderAddress ?? ""
  const senderWr = cfg.sepoliaSenderWriteReceiverAddress ?? ""
  const receiver = cfg.baseSepoliaReceiverAddress ?? ""
  const auditRegistry = cfg.sepoliaAuditRegistryAddress ?? ""
  const auditRegistryWr = cfg.sepoliaAuditRegistryWriteReceiverAddress ?? ""

  if (issuer && !isHexAddress(issuer)) failures.push("invalid_sepoliaIssuerAddress")
  if (issuerWr && !isHexAddress(issuerWr)) failures.push("invalid_sepoliaIssuerWriteReceiverAddress")
  if (sender && !isHexAddress(sender)) failures.push("invalid_sepoliaSenderAddress")
  if (senderWr && !isHexAddress(senderWr)) failures.push("invalid_sepoliaSenderWriteReceiverAddress")
  if (receiver && !isHexAddress(receiver)) failures.push("invalid_baseSepoliaReceiverAddress")
  if (auditRegistry && !isHexAddress(auditRegistry)) failures.push("invalid_sepoliaAuditRegistryAddress")
  if (auditRegistryWr && !isHexAddress(auditRegistryWr)) failures.push("invalid_sepoliaAuditRegistryWriteReceiverAddress")

  if (issuer && issuerWr) {
    try {
      const client = createPublicClient({ transport: http(sepoliaRpc) })
      const operator = (await client.readContract({
        address: issuer as any,
        abi: ISSUER_ABI,
        functionName: "operator",
      })) as string
      if (lower(operator) !== lower(issuerWr)) failures.push("issuer_operator_mismatch")
    } catch (e) {
      failures.push(`issuer_operator_check_failed ${(e as Error).message}`)
    }
  }

  if (sender && senderWr) {
    try {
      const client = createPublicClient({ transport: http(sepoliaRpc) })
      const operator = (await client.readContract({
        address: sender as any,
        abi: SENDER_ABI,
        functionName: "operator",
      })) as string
      if (lower(operator) !== lower(senderWr)) failures.push("sender_operator_mismatch")
    } catch (e) {
      failures.push(`sender_operator_check_failed ${(e as Error).message}`)
    }
  }

  let senderBalanceWei: string | null = null
  let senderEstimatedFeeWei: string | null = null
  let senderIsFunded: boolean | null = null

  if (sender && isHexAddress(sender)) {
    try {
      const client = createPublicClient({ transport: http(sepoliaRpc) })
      const bal = await client.getBalance({ address: sender as any })
      senderBalanceWei = bal.toString()

      let fee: bigint | null = null
      try {
        fee = (await client.readContract({
          address: sender as any,
          abi: SENDER_ABI,
          functionName: "estimateFee",
          args: ["0x0000000000000000000000000000000000000000", 0n, ZERO_BYTES32 as any],
        })) as bigint
      } catch {
        fee = null
      }

      if (fee !== null) senderEstimatedFeeWei = fee.toString()
      if (fee !== null) {
        senderIsFunded = bal >= fee
        if (!senderIsFunded) failures.push("ccip_sender_insufficient_balance")
      } else {
        senderIsFunded = bal > 0n
        if (!senderIsFunded) failures.push("ccip_sender_unfunded")
      }
    } catch (e) {
      failures.push(`ccip_sender_funding_check_failed ${(e as Error).message}`)
    }
  }

  let receiverAllowlistedSourceChain: boolean | null = null
  let receiverAllowlistedSender: boolean | null = null

  if (receiver && isHexAddress(receiver) && sender && isHexAddress(sender)) {
    try {
      const client = createPublicClient({ transport: http(baseRpc) })
      receiverAllowlistedSourceChain = (await client.readContract({
        address: receiver as any,
        abi: RECEIVER_ABI,
        functionName: "allowlistedSourceChains",
        args: [SEPOLIA_CHAIN_SELECTOR_ON_BASE],
      })) as boolean

      receiverAllowlistedSender = (await client.readContract({
        address: receiver as any,
        abi: RECEIVER_ABI,
        functionName: "allowlistedSenders",
        args: [sender as any],
      })) as boolean

      if (!receiverAllowlistedSourceChain) failures.push("base_receiver_source_chain_not_allowlisted")
      if (!receiverAllowlistedSender) failures.push("base_receiver_sender_not_allowlisted")
    } catch (e) {
      failures.push(`base_receiver_allowlist_check_failed ${(e as Error).message}`)
    }
  }

  if (auditRegistry && auditRegistryWr) {
    try {
      const client = createPublicClient({ transport: http(sepoliaRpc) })

      const code = await client.getBytecode({ address: auditRegistry as any })
      if (!code || code === "0x") {
        failures.push("auditRegistry_not_deployed")
      } else {
        const operator = (await client.readContract({
          address: auditRegistry as any,
          abi: AUDIT_REGISTRY_ABI,
          functionName: "operator",
        })) as string
        if (lower(operator) !== lower(auditRegistryWr)) failures.push("auditRegistry_operator_mismatch")
      }
    } catch (e) {
      failures.push(`auditRegistry_operator_check_failed ${(e as Error).message}`)
    }
  }

  const out = {
    ok: failures.length === 0,
    configPath,
    reserveApiBaseUrl: baseUrl,
    sepoliaRpc,
    baseRpc,
    creCli: crePath,
    sanctions: sanctionsMeta?.lists ?? undefined,
    issuer: issuer || undefined,
    issuerWriteReceiver: issuerWr || undefined,
    sender: sender || undefined,
    senderWriteReceiver: senderWr || undefined,
    receiver: receiver || undefined,
    ccipSenderBalanceWei: senderBalanceWei,
    ccipEstimatedFeeWei: senderEstimatedFeeWei,
    ccipSenderIsFunded: senderIsFunded,
    baseReceiverAllowlistedSourceChain: receiverAllowlistedSourceChain,
    baseReceiverAllowlistedSender: receiverAllowlistedSender,
    auditRegistry: auditRegistry || undefined,
    auditRegistryWriteReceiver: auditRegistryWr || undefined,
    failures,
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(out) + "\n")
    if (failures.length) process.exit(1)
    return
  }

  process.stdout.write(`config=${configPath}\n`)
  process.stdout.write(`reserveApiBaseUrl=${baseUrl}\n`)
  process.stdout.write(`sepoliaRpc=${sepoliaRpc}\n`)
  process.stdout.write(`baseRpc=${baseRpc}\n`)
  process.stdout.write(`creCli=${crePath}\n`)

  if (sanctionsMeta?.lists && typeof sanctionsMeta.lists === "object") {
    const listOrder = ["ofac_sdn_advanced", "eu_consolidated", "uk_sanctions_list"]
    const listIds = listOrder.filter((id) => sanctionsMeta.lists[id])
    process.stdout.write(`sanctionsLists=${listIds.join(",")}\n`)
    for (const id of listIds) {
      const sha = String(sanctionsMeta?.lists?.[id]?.sha256 ?? "")
      if (sha) process.stdout.write(`sanctions_${id}_sha256=${sha}\n`)
    }
  }

  if (issuer) process.stdout.write(`issuer=${issuer}\n`)
  if (issuerWr) process.stdout.write(`issuerWriteReceiver=${issuerWr}\n`)
  if (sender) process.stdout.write(`sender=${sender}\n`)
  if (senderWr) process.stdout.write(`senderWriteReceiver=${senderWr}\n`)
  if (receiver) process.stdout.write(`baseReceiver=${receiver}\n`)

  if (senderBalanceWei) process.stdout.write(`ccipSenderBalanceWei=${senderBalanceWei}\n`)
  if (senderEstimatedFeeWei) process.stdout.write(`ccipEstimatedFeeWei=${senderEstimatedFeeWei}\n`)
  if (senderIsFunded !== null) process.stdout.write(`ccipSenderFunded=${senderIsFunded ? "true" : "false"}\n`)
  if (receiverAllowlistedSourceChain !== null)
    process.stdout.write(`baseReceiverAllowlistedSourceChain=${receiverAllowlistedSourceChain ? "true" : "false"}\n`)
  if (receiverAllowlistedSender !== null)
    process.stdout.write(`baseReceiverAllowlistedSender=${receiverAllowlistedSender ? "true" : "false"}\n`)
  if (auditRegistry) process.stdout.write(`auditRegistry=${auditRegistry}\n`)
  if (auditRegistryWr) process.stdout.write(`auditRegistryWriteReceiver=${auditRegistryWr}\n`)

  process.stdout.write(`ok=${fmtBool(failures.length === 0)}\n`)

  if (failures.length) {
    for (const f of failures) process.stdout.write(`fail=${f}\n`)
    process.exit(1)
  }
}
