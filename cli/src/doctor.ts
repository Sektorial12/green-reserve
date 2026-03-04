import { createPublicClient, http, parseAbi } from "viem"
import { asUrlBase, fmtBool, httpGetJson, isHexAddress, lower } from "./util"
import { defaultWorkflowConfigPath, readWorkflowConfig } from "./config"

const ISSUER_ABI = parseAbi(["function operator() view returns (address)"])
const SENDER_ABI = parseAbi(["function operator() view returns (address)"])
const AUDIT_REGISTRY_ABI = parseAbi(["function operator() view returns (address)"])

export const runDoctor = async (opts: {
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

  const failures: string[] = []

  const crePath = opts.crePath ?? process.env.CRE_CLI_PATH ?? Bun.which("cre") ?? ""
  if (!crePath) failures.push("missing_cre_cli")

  try {
    const health = await httpGetJson<{ ok: boolean }>(`${baseUrl}/health`)
    if (!health.ok) failures.push("reserve_api_health_not_ok")
  } catch (e) {
    failures.push(`reserve_api_unreachable ${(e as Error).message}`)
  }

  try {
    const maxWaitMs = Number.parseInt(process.env.DOCTOR_SANCTIONS_WAIT_MS ?? "60000", 10)
    const start = Date.now()
    let lastErr: Error | null = null
    while (true) {
      try {
        const meta = await httpGetJson<any>(`${baseUrl}/sanctions/meta`)
        if (!meta?.ok) {
          lastErr = new Error("sanctions_meta_not_ok")
        } else {
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
  const auditRegistry = cfg.sepoliaAuditRegistryAddress ?? ""
  const auditRegistryWr = cfg.sepoliaAuditRegistryWriteReceiverAddress ?? ""

  if (issuer && !isHexAddress(issuer)) failures.push("invalid_sepoliaIssuerAddress")
  if (issuerWr && !isHexAddress(issuerWr)) failures.push("invalid_sepoliaIssuerWriteReceiverAddress")
  if (sender && !isHexAddress(sender)) failures.push("invalid_sepoliaSenderAddress")
  if (senderWr && !isHexAddress(senderWr)) failures.push("invalid_sepoliaSenderWriteReceiverAddress")
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

  process.stdout.write(`config=${configPath}\n`)
  process.stdout.write(`reserveApiBaseUrl=${baseUrl}\n`)
  process.stdout.write(`sepoliaRpc=${sepoliaRpc}\n`)
  process.stdout.write(`creCli=${crePath}\n`)

  if (issuer) process.stdout.write(`issuer=${issuer}\n`)
  if (issuerWr) process.stdout.write(`issuerWriteReceiver=${issuerWr}\n`)
  if (sender) process.stdout.write(`sender=${sender}\n`)
  if (senderWr) process.stdout.write(`senderWriteReceiver=${senderWr}\n`)
  if (auditRegistry) process.stdout.write(`auditRegistry=${auditRegistry}\n`)
  if (auditRegistryWr) process.stdout.write(`auditRegistryWriteReceiver=${auditRegistryWr}\n`)

  process.stdout.write(`ok=${fmtBool(failures.length === 0)}\n`)

  if (failures.length) {
    for (const f of failures) process.stdout.write(`fail=${f}\n`)
    process.exit(1)
  }
}
