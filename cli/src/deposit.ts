import prompts from "prompts"
import path from "node:path"
import { createPublicClient, hashMessage, http, parseAbi, parseEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { asUrlBase, httpGetJson, httpPostJson, isHexAddress, isHexBytes32, lower, repoRoot } from "./util"
import { defaultWorkflowConfigPath, readWorkflowConfig } from "./config"

const ISSUER_ABI = parseAbi(["function usedDepositId(bytes32 depositId) view returns (bool)"])
const RECEIVER_ABI = parseAbi(["function processedDepositId(bytes32 depositId) view returns (bool)"])
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"])

type DepositNotice = {
  version: string
  custodian: string
  onchain: {
    to: string
    chain: string
  }
  amountWei: string
  timestamp: number
}

const makeDepositNoticeMessage = (n: DepositNotice, custodianAddress: string): string => {
  return [
    "GreenReserveDepositNotice:v1",
    `version=${n.version}`,
    `custodian=${n.custodian}`,
    `to=${n.onchain.to.toLowerCase()}`,
    `chain=${n.onchain.chain}`,
    `amountWei=${n.amountWei}`,
    `timestamp=${n.timestamp}`,
    `custodianAddress=${custodianAddress.toLowerCase()}`,
  ].join("\n")
}

export const runDepositCreate = async (opts: {
  configFile?: string
  reserveApiBaseUrl?: string
  to?: string
  amountEth?: string
  chain?: string
  custodian?: string
  custodianPrivateKey?: string
}) => {
  const configPath = opts.configFile ?? defaultWorkflowConfigPath()
  const cfg = await readWorkflowConfig(configPath)
  const baseUrl = asUrlBase(opts.reserveApiBaseUrl ?? process.env.RESERVE_API_BASE_URL ?? cfg.reserveApiBaseUrl)

  const pk = (opts.custodianPrivateKey ?? process.env.CUSTODIAN_PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY ?? "").trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("missing_or_invalid_custodian_private_key")

  const account = privateKeyToAccount(pk as `0x${string}`)

  const initialTo = opts.to ?? account.address
  const initialAmountEth = opts.amountEth ?? ""
  const initialChain = opts.chain ?? "base-sepolia"
  const initialCustodian = opts.custodian ?? "cli"

  const isInteractive = process.stdin.isTTY
  const answers = isInteractive
    ? await prompts(
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
            initial: "1",
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
    : { to: initialTo, amountEth: initialAmountEth, chain: initialChain, custodian: initialCustodian }

  const to = lower(String(opts.to ?? answers.to ?? initialTo).trim())
  if (!isHexAddress(to)) throw new Error("invalid_to")

  const amountEthStr = String(opts.amountEth ?? answers.amountEth ?? initialAmountEth ?? "1").trim()
  const amountWei = parseEther(amountEthStr).toString()

  const chain = String(answers.chain ?? initialChain).trim()
  if (!chain) throw new Error("invalid_chain")

  const custodian = String(answers.custodian ?? initialCustodian).trim()
  if (!custodian) throw new Error("invalid_custodian")

  const notice: DepositNotice = {
    version: "1",
    custodian,
    onchain: { to, chain },
    amountWei,
    timestamp: Math.floor(Date.now() / 1000),
  }

  const message = makeDepositNoticeMessage(notice, account.address)
  const signature = await account.signMessage({ message })
  const messageHash = hashMessage(message)

  const resp = await httpPostJson<{ depositId: string; custodianAddress: string; messageHash: string }>(`${baseUrl}/deposits`, {
    notice,
    custodianAddress: account.address,
    signature,
  })

  process.stdout.write(`depositId=${resp.depositId}\n`)
  process.stdout.write(`custodianAddress=${resp.custodianAddress}\n`)
  process.stdout.write(`messageHash=${resp.messageHash}\n`)
  process.stdout.write(`clientMessageHash=${messageHash}\n`)
}

export const runDepositSubmit = async (opts: {
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
    const tmpPath = path.join(Bun.tmpdir(), `greenreserve-${depositId}-${Date.now()}.json`)
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
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })

  const code = await proc.exited
  if (code !== 0) process.exit(code)
}

export const runDepositStatus = async (opts: {
  configFile?: string
  reserveApiBaseUrl?: string
  depositId: string
  sepoliaRpc?: string
  baseRpc?: string
}) => {
  const configPath = opts.configFile ?? defaultWorkflowConfigPath()
  const cfg = await readWorkflowConfig(configPath)

  const baseUrl = asUrlBase(opts.reserveApiBaseUrl ?? process.env.RESERVE_API_BASE_URL ?? cfg.reserveApiBaseUrl)
  const depositId = opts.depositId
  if (!isHexBytes32(depositId)) throw new Error("invalid_depositId")

  const sepoliaRpc = opts.sepoliaRpc ?? process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com"
  const baseRpc = opts.baseRpc ?? process.env.BASE_RPC ?? "https://sepolia.base.org"

  const dep = await httpGetJson<any>(`${baseUrl}/deposits?depositId=${encodeURIComponent(depositId)}`)

  const to = String(dep?.notice?.onchain?.to ?? "")
  const amountWei = String(dep?.notice?.amountWei ?? "")

  process.stdout.write(`depositId=${depositId}\n`)
  if (to) process.stdout.write(`to=${to}\n`)
  if (amountWei) process.stdout.write(`amountWei=${amountWei}\n`)

  const issuer = cfg.sepoliaIssuerAddress ?? ""
  const receiver = cfg.baseSepoliaReceiverAddress ?? ""
  const tokenB = cfg.baseSepoliaTokenBAddress ?? ""

  if (!issuer || !isHexAddress(issuer)) throw new Error("missing_or_invalid_sepoliaIssuerAddress")
  if (!receiver || !isHexAddress(receiver)) throw new Error("missing_or_invalid_baseSepoliaReceiverAddress")

  const sepoliaClient = createPublicClient({ transport: http(sepoliaRpc) })
  const baseClient = createPublicClient({ transport: http(baseRpc) })

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

  process.stdout.write(`usedDepositId=${used ? "true" : "false"}\n`)
  process.stdout.write(`processedDepositId=${processed ? "true" : "false"}\n`)

  if (processed && tokenB && isHexAddress(tokenB) && to && isHexAddress(to)) {
    const bal = (await baseClient.readContract({
      address: tokenB as any,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [to as any],
    })) as bigint
    process.stdout.write(`tokenBBalance=${bal.toString()}\n`)
  }
}
