import prompts from "prompts"
import path from "node:path"
import { tmpdir } from "node:os"
import { createPublicClient, decodeEventLog, hashMessage, http, parseAbi, parseEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { asUrlBase, httpGetJson, httpPostJson, isHexAddress, isHexBytes32, lower, repoRoot } from "./util"
import { defaultWorkflowConfigPath, readWorkflowConfig } from "./config"

const ISSUER_ABI = parseAbi(["function usedDepositId(bytes32 depositId) view returns (bool)"])
const RECEIVER_ABI = parseAbi(["function processedDepositId(bytes32 depositId) view returns (bool)"])
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"])
const SENDER_EVENT_ABI = parseAbi([
  "event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed to, uint256 amount)",
])
const AUDIT_REGISTRY_ABI = parseAbi([
  "function auditByDepositId(bytes32 depositId) view returns (bytes32 depositNoticeHash, bytes32 reserveAttestationHash, bytes32 complianceDecisionHash, bytes32 aiOutputHash, uint64 updatedAt, address updater)",
])

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

export const runDepositCreate = async (opts: {
  json?: boolean
  configFile?: string
  reserveApiBaseUrl?: string
  crePath?: string
  nonInteractive?: boolean
  noticeVersion?: string
  to?: string
  amountEth?: string
  chain?: string
  custodian?: string
  assetType?: string
  assetRegistry?: string
  assetProjectId?: string
  fiatCurrency?: string
  fiatAmount?: string
  evidenceUrl?: string
  custodianPrivateKey?: string
}) => {
  const configPath = opts.configFile ?? defaultWorkflowConfigPath()
  const cfg = await readWorkflowConfig(configPath)
  const baseUrl = asUrlBase(opts.reserveApiBaseUrl ?? process.env.RESERVE_API_BASE_URL ?? cfg.reserveApiBaseUrl)

  const pk = (opts.custodianPrivateKey ?? process.env.CUSTODIAN_PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY ?? "").trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("missing_or_invalid_custodian_private_key")

  const account = privateKeyToAccount(pk as `0x${string}`)

  const initialTo = opts.to ?? account.address
  const initialAmountEth = opts.amountEth ?? "1"
  const initialChain = opts.chain ?? "base-sepolia"
  const initialCustodian = opts.custodian ?? "cli"

  const allowPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY && !opts.nonInteractive)
  const answers = await (async () => {
    if (!allowPrompt) {
      return { to: initialTo, amountEth: initialAmountEth, chain: initialChain, custodian: initialCustodian }
    }
    try {
      return await prompts(
        [
          {
            type: opts.to ? null : "text",
            name: "to",
            message: "recipient address",
            initial: initialTo,
            validate: (v: string) => (isHexAddress(v) ? true : "invalid address"),
          },
          {
            type: opts.amountEth ? null : "text",
            name: "amountEth",
            message: "amount in ETH",
            initial: initialAmountEth,
            validate: (v: string) => (Number.isFinite(Number(v)) && Number(v) > 0 ? true : "invalid amount"),
          },
          {
            type: "text",
            name: "chain",
            message: "onchain.chain",
            initial: initialChain,
          },
          {
            type: "text",
            name: "custodian",
            message: "custodian name",
            initial: initialCustodian,
          },
        ],
        { onCancel: () => process.exit(1) }
      )
    } catch {
      return { to: initialTo, amountEth: initialAmountEth, chain: initialChain, custodian: initialCustodian }
    }
  })()

  const to = lower(String(opts.to ?? answers.to ?? initialTo).trim())
  if (!isHexAddress(to)) throw new Error("invalid_to")

  const amountEthStr = String(opts.amountEth ?? answers.amountEth ?? initialAmountEth ?? "1").trim() || "1"
  const amountWei = parseEther(amountEthStr).toString()

  const chain = String(answers.chain ?? initialChain).trim()
  if (!chain) throw new Error("invalid_chain")

  const custodian = String(answers.custodian ?? initialCustodian).trim()
  if (!custodian) throw new Error("invalid_custodian")

  const requestedVersion = String(opts.noticeVersion ?? "").trim()
  if (requestedVersion && requestedVersion !== "1" && requestedVersion !== "2") {
    throw new Error("invalid_notice_version")
  }

  const hasExtendedFields = Boolean(
    (opts.assetType ?? "").trim() ||
      (opts.assetRegistry ?? "").trim() ||
      (opts.assetProjectId ?? "").trim() ||
      (opts.fiatCurrency ?? "").trim() ||
      (opts.fiatAmount ?? "").trim() ||
      (opts.evidenceUrl ?? "").trim(),
  )

  const noticeVersion = requestedVersion || (hasExtendedFields ? "2" : "1")
  if (noticeVersion !== "1" && noticeVersion !== "2") throw new Error("invalid_notice_version")
  if (noticeVersion === "1" && hasExtendedFields) throw new Error("notice_version_required_for_extended_fields")

  const notice: DepositNotice = {
    version: noticeVersion,
    custodian,
    onchain: { to, chain },
    amountWei,
    timestamp: Math.floor(Date.now() / 1000),
    ...(noticeVersion === "2"
      ? {
          asset: {
            type: (opts.assetType ?? "").trim() || undefined,
            registry: (opts.assetRegistry ?? "").trim() || undefined,
            projectId: (opts.assetProjectId ?? "").trim() || undefined,
          },
          fiat: {
            currency: (opts.fiatCurrency ?? "").trim() || undefined,
            amount: (opts.fiatAmount ?? "").trim() || undefined,
          },
          evidenceUrl: (opts.evidenceUrl ?? "").trim() || undefined,
        }
      : {}),
  }

  const message = makeDepositNoticeMessage(notice, account.address)
  const signature = await account.signMessage({ message })
  const messageHash = hashMessage(message)

  const resp = await httpPostJson<{ depositId: string; custodianAddress: string; messageHash: string }>(`${baseUrl}/deposits`, {
    notice,
    custodianAddress: account.address,
    signature,
  })

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        depositId: resp.depositId,
        custodianAddress: resp.custodianAddress,
        messageHash: resp.messageHash,
        clientMessageHash: messageHash,
      }) + "\n",
    )
    return
  }

  process.stdout.write(`depositId=${resp.depositId}\n`)
  process.stdout.write(`custodianAddress=${resp.custodianAddress}\n`)
  process.stdout.write(`messageHash=${resp.messageHash}\n`)
  process.stdout.write(`clientMessageHash=${messageHash}\n`)
}

export const runDepositSubmit = async (opts: {
  json?: boolean
  depositId: string
  scenario?: string
  target?: string
  triggerIndex?: number
  payloadFile?: string
  crePath?: string
}) => {
  const depositId = opts.depositId
  if (!isHexBytes32(depositId)) throw new Error("invalid_depositId")

  const target = opts.target ?? process.env.TARGET ?? "staging-settings"
  const triggerIndex = Number.isFinite(opts.triggerIndex) ? (opts.triggerIndex as number) : 0
  const scenario = opts.scenario ?? "healthy"

  const crePath = opts.crePath ?? process.env.CRE_CLI_PATH ?? Bun.which("cre")
  if (!crePath) throw new Error("missing_cre_cli")

  if (!process.env.CRE_ETH_PRIVATE_KEY) throw new Error("missing_CRE_ETH_PRIVATE_KEY")

  const payload = {
    depositId,
    scenario,
  }

  let tmp = opts.payloadFile
  if (!tmp) {
    const tmpPath = path.join(tmpdir(), `greenreserve-${depositId}-${Date.now()}.json`)
    await Bun.write(tmpPath, JSON.stringify(payload, null, 2) + "\n")
    tmp = tmpPath
  }

  const args = [
    "workflow",
    "simulate",
    "./workflows/greenreserve-workflow",
    "-R",
    ".",
    "-T",
    target,
    "--trigger-index",
    String(triggerIndex),
    "--http-payload",
    `@${tmp}`,
    "--broadcast",
    "--non-interactive",
  ]

  const proc = Bun.spawn([crePath, ...args], {
    cwd: repoRoot,
    stdin: "inherit",
    stdout: opts.json ? "pipe" : "inherit",
    stderr: opts.json ? "pipe" : "inherit",
    env: process.env,
  })

  if (opts.json) {
    const drainToStderr = async (body: unknown) => {
      const ab = await new Response(body as any).arrayBuffer()
      process.stderr.write(new Uint8Array(ab))
    }

    const drains: Promise<void>[] = []
    if (proc.stdout) drains.push(drainToStderr(proc.stdout))
    if (proc.stderr) drains.push(drainToStderr(proc.stderr))
    await Promise.all(drains)
  }

  const code = await proc.exited
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        ok: code === 0,
        depositId,
        scenario,
        target,
        triggerIndex,
        payloadFile: tmp,
        exitCode: code,
      }) + "\n",
    )
  }

  if (code !== 0) process.exit(code)
}

export const runDepositStatus = async (opts: {
  json?: boolean
  configFile?: string
  reserveApiBaseUrl?: string
  depositId: string
  sepoliaRpc?: string
  baseRpc?: string
  ccipTxHash?: string
  messageId?: string
  watch?: boolean
  intervalSec?: number
}) => {
  const configPath = opts.configFile ?? defaultWorkflowConfigPath()
  const cfg = await readWorkflowConfig(configPath)

  const baseUrl = asUrlBase(opts.reserveApiBaseUrl ?? process.env.RESERVE_API_BASE_URL ?? cfg.reserveApiBaseUrl)
  const depositId = opts.depositId
  if (!isHexBytes32(depositId)) throw new Error("invalid_depositId")

  const sepoliaRpc = opts.sepoliaRpc ?? process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com"
  const baseRpc = opts.baseRpc ?? process.env.BASE_RPC ?? "https://sepolia.base.org"

  const sender = cfg.sepoliaSenderAddress ?? ""

  const ccipTxHash = (opts.ccipTxHash ?? "").trim()
  if (ccipTxHash && !isHexBytes32(ccipTxHash)) throw new Error("invalid_ccip_tx_hash")

  const providedMessageId = (opts.messageId ?? "").trim()
  if (providedMessageId && !isHexBytes32(providedMessageId)) throw new Error("invalid_message_id")

  const sepoliaExplorerBase = "https://sepolia.etherscan.io"
  const baseSepoliaExplorerBase = "https://sepolia.basescan.org"
  const ccipExplorerBase = "https://ccip.chain.link/msg"

  const sepoliaClient = createPublicClient({ transport: http(sepoliaRpc) })
  const baseClient = createPublicClient({ transport: http(baseRpc) })

  const decodeMessageSentFromTx = async (): Promise<null | { messageId: string; to: string; amountWei: string }> => {
    if (!ccipTxHash) return null
    try {
      const receipt = await sepoliaClient.getTransactionReceipt({ hash: ccipTxHash as any })
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: SENDER_EVENT_ABI,
            data: log.data,
            topics: log.topics,
          }) as any

          if (decoded?.eventName !== "MessageSent") continue
          if (String(decoded?.args?.depositId ?? "").toLowerCase() !== depositId.toLowerCase()) continue
          const addr = String((log as any).address ?? "")
          if (sender && isHexAddress(sender) && addr && addr.toLowerCase() !== sender.toLowerCase()) continue
          const mid = String(decoded?.args?.messageId ?? "")
          const to = String(decoded?.args?.to ?? "")
          const amount = decoded?.args?.amount as unknown

          const messageId = isHexBytes32(mid) ? mid : ""
          const amountWei = typeof amount === "bigint" ? amount.toString() : String(amount ?? "")
          return {
            messageId,
            to: isHexAddress(to) ? to : "",
            amountWei: /^[0-9]+$/.test(amountWei) ? amountWei : "",
          }
        } catch {
          // ignore non-matching logs
        }
      }
    } catch {
      return null
    }
    return null
  }

  let noticeFallback: null | { to: string; amountWei: string } = null

  const pollOnce = async () => {
    let to = ""
    let amountWei = ""
    let depositNoticeSource: "reserve_api" | "ccip_tx" | null = null
    let reserveApiError: string | null = null

    try {
      const dep = await httpGetJson<any>(`${baseUrl}/deposits?depositId=${encodeURIComponent(depositId)}`)
      to = String(dep?.notice?.onchain?.to ?? "")
      amountWei = String(dep?.notice?.amountWei ?? "")
      if (isHexAddress(to) && /^[0-9]+$/.test(amountWei)) {
        depositNoticeSource = "reserve_api"
      }
    } catch (e) {
      reserveApiError = (e as Error).message
      if (noticeFallback && noticeFallback.to && noticeFallback.amountWei) {
        to = noticeFallback.to
        amountWei = noticeFallback.amountWei
        depositNoticeSource = "ccip_tx"
      } else {
        throw e
      }
    }

    const issuer = cfg.sepoliaIssuerAddress ?? ""
    const receiver = cfg.baseSepoliaReceiverAddress ?? ""
    const tokenB = cfg.baseSepoliaTokenBAddress ?? ""

    if (!issuer || !isHexAddress(issuer)) throw new Error("missing_or_invalid_sepoliaIssuerAddress")
    if (!receiver || !isHexAddress(receiver)) throw new Error("missing_or_invalid_baseSepoliaReceiverAddress")

    let audit:
      | null
      | {
          depositNoticeHash: string
          reserveAttestationHash: string
          complianceDecisionHash: string
          aiOutputHash: string
          updatedAt: string
          updater: string
        } = null

    const auditRegistry = cfg.sepoliaAuditRegistryAddress ?? ""
    if (auditRegistry && isHexAddress(auditRegistry)) {
      try {
        const result = (await sepoliaClient.readContract({
          address: auditRegistry as any,
          abi: AUDIT_REGISTRY_ABI,
          functionName: "auditByDepositId",
          args: [depositId as any],
        })) as any

        audit = {
          depositNoticeHash: String(result?.[0] ?? ""),
          reserveAttestationHash: String(result?.[1] ?? ""),
          complianceDecisionHash: String(result?.[2] ?? ""),
          aiOutputHash: String(result?.[3] ?? ""),
          updatedAt: String(result?.[4] ?? ""),
          updater: String(result?.[5] ?? ""),
        }
      } catch {
        audit = null
      }
    }

    const used = (await sepoliaClient.readContract({
      address: issuer as any,
      abi: ISSUER_ABI,
      functionName: "usedDepositId",
      args: [depositId as any],
    })) as boolean

    const processed = (await baseClient.readContract({
      address: receiver as any,
      abi: RECEIVER_ABI,
      functionName: "processedDepositId",
      args: [depositId as any],
    })) as boolean

    let tokenBBalance: string | null = null
    if (processed && tokenB && isHexAddress(tokenB) && to && isHexAddress(to)) {
      const bal = (await baseClient.readContract({
        address: tokenB as any,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [to as any],
      })) as bigint
      tokenBBalance = bal.toString()
    }

    return { to, amountWei, used, processed, tokenBBalance, audit, depositNoticeSource, reserveApiError }
  }

  if (!opts.json) {
    process.stdout.write(`depositId=${depositId}\n`)
  }

  const ccipTxUrl = ccipTxHash ? `${sepoliaExplorerBase}/tx/${ccipTxHash}` : ""
  let decodedMessageId = providedMessageId
  let ccipMsgUrl = decodedMessageId ? `${ccipExplorerBase}/${decodedMessageId}` : ""

  const normalizeAudit = (
    audit:
      | null
      | {
          depositNoticeHash: string
          reserveAttestationHash: string
          complianceDecisionHash: string
          aiOutputHash: string
          updatedAt: string
          updater: string
        },
  ) => {
    if (!audit) return null
    return {
      depositNoticeHash: audit.depositNoticeHash || null,
      reserveAttestationHash: audit.reserveAttestationHash || null,
      complianceDecisionHash: audit.complianceDecisionHash || null,
      aiOutputHash: audit.aiOutputHash || null,
      updatedAt: audit.updatedAt || null,
      updater: audit.updater || null,
    }
  }

  const intervalSec = Number.isFinite(opts.intervalSec) ? (opts.intervalSec as number) : 5
  const watch = Boolean(opts.watch)

  let printedCcipTx = false
  let printedCcipMsg = false
  let seq = 0

  while (true) {
    if ((ccipTxHash && !decodedMessageId) || (ccipTxHash && !noticeFallback)) {
      const sent = await decodeMessageSentFromTx()
      if (sent) {
        if (!decodedMessageId && sent.messageId) {
          decodedMessageId = sent.messageId
          ccipMsgUrl = `${ccipExplorerBase}/${decodedMessageId}`
        }

        if (sent.to && sent.amountWei) {
          noticeFallback = { to: sent.to, amountWei: sent.amountWei }
        }
      }
    }

    const { to, amountWei, used, processed, tokenBBalance, audit, depositNoticeSource, reserveApiError } = await pollOnce()

    if (opts.json) {
      seq += 1
      process.stdout.write(
        JSON.stringify({
          depositId,
          sequence: seq,
          observedAtMs: Date.now(),
          ccipTxHash: ccipTxHash || null,
          messageId: decodedMessageId || null,
          ccipTxUrl: ccipTxUrl || null,
          ccipMsgUrl: ccipMsgUrl || null,
          depositNoticeSource,
          reserveApiError,
          to: to || null,
          amountWei: amountWei || null,
          usedDepositId: used,
          processedDepositId: processed,
          tokenBBalance,
          baseSepoliaAddressUrl: processed && to && isHexAddress(to) ? `${baseSepoliaExplorerBase}/address/${to}` : null,
          audit: normalizeAudit(audit),
        }) + "\n",
      )
    } else {
      if (!printedCcipTx) {
        if (ccipTxHash) process.stdout.write(`ccipTxHash=${ccipTxHash}\n`)
        if (ccipTxUrl) process.stdout.write(`ccipTxExplorer=${ccipTxUrl}\n`)
        printedCcipTx = true
      }

      if (!printedCcipMsg && decodedMessageId) {
        process.stdout.write(`ccipMessageId=${decodedMessageId}\n`)
        if (ccipMsgUrl) process.stdout.write(`ccipMsgExplorer=${ccipMsgUrl}\n`)
        printedCcipMsg = true
      }

      if (depositNoticeSource) process.stdout.write(`depositNoticeSource=${depositNoticeSource}\n`)
      if (reserveApiError) process.stdout.write(`reserveApiError=${reserveApiError}\n`)

      if (to) process.stdout.write(`to=${to}\n`)
      if (amountWei) process.stdout.write(`amountWei=${amountWei}\n`)
      process.stdout.write(`usedDepositId=${used ? "true" : "false"}\n`)
      process.stdout.write(`processedDepositId=${processed ? "true" : "false"}\n`)
      if (tokenBBalance !== null) process.stdout.write(`tokenBBalance=${tokenBBalance}\n`)

      if (processed && to && isHexAddress(to)) {
        process.stdout.write(`baseSepoliaAddressExplorer=${baseSepoliaExplorerBase}/address/${to}\n`)
      }

      if (audit) {
        if (audit.depositNoticeHash) process.stdout.write(`auditDepositNoticeHash=${audit.depositNoticeHash}\n`)
        if (audit.reserveAttestationHash)
          process.stdout.write(`auditReserveAttestationHash=${audit.reserveAttestationHash}\n`)
        if (audit.complianceDecisionHash)
          process.stdout.write(`auditComplianceDecisionHash=${audit.complianceDecisionHash}\n`)
        if (audit.aiOutputHash) process.stdout.write(`auditAiOutputHash=${audit.aiOutputHash}\n`)
        if (audit.updatedAt) process.stdout.write(`auditUpdatedAt=${audit.updatedAt}\n`)
        if (audit.updater) process.stdout.write(`auditUpdater=${audit.updater}\n`)
      }
    }

    if (!watch || processed) break
    await new Promise((r) => setTimeout(r, Math.max(1, intervalSec) * 1000))
  }
}
