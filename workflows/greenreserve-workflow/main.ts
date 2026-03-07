import {
  Runner,
  bytesToHex,
  blockNumber,
  consensusIdenticalAggregation,
  cre,
  encodeCallMsg,
  getNetwork,
  hexToBase64,
  ok,
  prepareReportRequest,
  protoBigIntToBigint,
  text,
  type HTTPPayload,
  type Runtime,
  LAST_FINALIZED_BLOCK_NUMBER,
} from "@chainlink/cre-sdk"
import { z } from "zod"

import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  hashMessage,
  keccak256,
  parseAbi,
  recoverAddress,
  sha256,
  toBytes,
  zeroAddress,
} from "viem"

const configSchema = z.object({
  reserveApiBaseUrl: z.string(),
  sepoliaChainSelectorName: z.string(),
  sepoliaCcipRouterAddress: z.string(),
  destChainSelector: z.string(),
  sepoliaWriteGasLimit: z.string().optional(),
  sepoliaTokenAAddress: z.string().optional(),
  sepoliaIssuerAddress: z.string().optional(),
  sepoliaIssuerWriteReceiverAddress: z.string().optional(),
  sepoliaSenderAddress: z.string().optional(),
  sepoliaSenderWriteReceiverAddress: z.string().optional(),
  sepoliaAuditRegistryAddress: z.string().optional(),
  sepoliaAuditRegistryWriteReceiverAddress: z.string().optional(),
  baseSepoliaTokenBAddress: z.string().optional(),
  baseSepoliaReceiverAddress: z.string().optional(),
})

type Config = z.infer<typeof configSchema>

const base64ToBytes = (value: string): Uint8Array | undefined => {
  const cleanedUnpadded = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/")
  if (cleanedUnpadded.length === 0) return undefined
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanedUnpadded)) return undefined

  let cleaned = cleanedUnpadded
  const remainder = cleaned.length % 4
  if (remainder === 1) return undefined
  if (remainder === 2) cleaned = `${cleaned}==`
  if (remainder === 3) cleaned = `${cleaned}=`

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0
  const outputLen = (cleaned.length / 4) * 3 - padding
  if (outputLen < 0) return undefined

  const output = new Uint8Array(outputLen)
  let outIndex = 0

  for (let index = 0; index < cleaned.length; index += 4) {
    const c0 = cleaned[index] ?? ""
    const c1 = cleaned[index + 1] ?? ""
    const c2 = cleaned[index + 2] ?? ""
    const c3 = cleaned[index + 3] ?? ""

    const v0 = alphabet.indexOf(c0)
    const v1 = alphabet.indexOf(c1)
    const v2 = c2 === "=" ? 0 : alphabet.indexOf(c2)
    const v3 = c3 === "=" ? 0 : alphabet.indexOf(c3)
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return undefined

    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3
    if (outIndex < outputLen) output[outIndex] = (triple >> 16) & 0xff
    outIndex += 1
    if (outIndex < outputLen && c2 !== "=") output[outIndex] = (triple >> 8) & 0xff
    outIndex += 1
    if (outIndex < outputLen && c3 !== "=") output[outIndex] = triple & 0xff
    outIndex += 1
  }

  return output
}

const depositSchema = z.object({
  depositId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  to: z.string().optional(),
  amount: z.string().optional(),
  scenario: z.enum(["healthy", "unhealthy"]).optional(),
})

type DepositPayload = z.infer<typeof depositSchema>

const depositApiResponseSchema = z
  .object({
    ok: z.literal(true),
    depositId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    notice: z.object({
      version: z.enum(["1", "2"]),
      custodian: z.string(),
      asset: z
        .object({
          type: z.string().optional(),
          registry: z.string().optional(),
          projectId: z.string().optional(),
        })
        .optional(),
      fiat: z
        .object({
          currency: z.string().optional(),
          amount: z.string().optional(),
        })
        .optional(),
      onchain: z.object({
        to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        chain: z.string(),
      }),
      amountWei: z.string().regex(/^[0-9]+$/),
      timestamp: z.number().int().positive(),
      evidenceUrl: z.string().optional(),
    }),
    custodianAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    messageHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).nullable().optional(),
  })
  .passthrough()

type DepositApiResponse = z.infer<typeof depositApiResponseSchema>

const reservesApiResponseSchema = z
  .object({
    asOfTimestamp: z.number().int().positive(),
    totalReservesUsd: z.string().regex(/^[0-9]+$/),
    totalLiabilitiesUsd: z.string().regex(/^[0-9]+$/),
    reserveRatioBps: z.string().regex(/^[0-9]+$/),
    proofRef: z.string(),
    auditor: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    messageHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  })
  .passthrough()

type ReservesApiResponse = z.infer<typeof reservesApiResponseSchema>

const kycApiResponseSchema = z
  .object({
    isAllowed: z.boolean(),
    reason: z.string().optional(),
    ruleId: z.string().optional(),
    checkedAt: z.string().optional(),
    listVersion: z.string().optional(),
    evidence: z.unknown().optional(),
  })
  .passthrough()

type KycApiResponse = z.infer<typeof kycApiResponseSchema>

const aiRiskMemoResponseSchema = z
  .object({
    ok: z.literal(true),
    memo: z.object({
      riskScore: z.number().int().min(0).max(100),
      confidence: z.number().min(0).max(1),
      decision: z.enum(["approve", "manual_review", "reject"]),
      reasons: z.array(z.string()),
    }),
    createdAtMs: z.number().int().nonnegative().optional(),
    memoSha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
    inputSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
    model: z.string().optional(),
    promptVersion: z.string().optional(),
    external: z
      .object({
        rssUrl: z.string().optional(),
        rssSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
        jsonUrl: z.string().optional(),
        jsonSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

type AiRiskMemoResponse = z.infer<typeof aiRiskMemoResponseSchema>

const safeJsonParse = (textValue: string): unknown => {
  try {
    return JSON.parse(textValue)
  } catch {
    throw new Error("invalid_json")
  }
}

const makeDepositNoticeMessage = (
  n: DepositApiResponse["notice"],
  custodianAddress: string,
): string => {
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

const makeReserveAttestationMessage = (r: ReservesApiResponse): string => {
  return [
    "GreenReserveReserveAttestation:v1",
    `asOfTimestamp=${r.asOfTimestamp}`,
    `totalReservesUsd=${r.totalReservesUsd}`,
    `totalLiabilitiesUsd=${r.totalLiabilitiesUsd}`,
    `reserveRatioBps=${r.reserveRatioBps}`,
    `proofRef=${r.proofRef}`,
    `auditor=${r.auditor.toLowerCase()}`,
  ].join("\n")
}

const ROUTER_ABI = parseAbi(["function isChainSupported(uint64 chainSelector) view returns (bool)"])

const ISSUER_ABI = parseAbi([
  "function usedDepositId(bytes32 depositId) view returns (bool)",
  "function mint(address to, uint256 amount, bytes32 depositId)",
])

const SENDER_ABI = parseAbi([
  "function destinationChainSelector() view returns (uint64)",
  "function destinationReceiver() view returns (address)",
  "function operator() view returns (address)",
  "function gasLimit() view returns (uint256)",
  "function router() view returns (address)",
  "function estimateFee(address to, uint256 amount, bytes32 depositId) view returns (uint256)",
  "function send(address to, uint256 amount, bytes32 depositId) returns (bytes32)",
])

const RECEIVER_ABI = parseAbi([
  "function processedDepositId(bytes32 depositId) view returns (bool)",
  "function getRouter() view returns (address)",
])

const AUDIT_REGISTRY_ABI = parseAbi([
  "function record(bytes32 depositId, bytes32 depositNoticeHash, bytes32 reserveAttestationHash, bytes32 complianceDecisionHash, bytes32 aiOutputHash, bytes32[6] aiHashes, uint64[3] aiMetrics)",
])

const ZERO_BYTES32 = ("0x" + "0".repeat(64)) as `0x${string}`

const MESSAGE_SENT_TOPIC0 = "0xaf252146b623abbfc7d709584e656c80ec1b71e27d4a23ee2f8d1391caaddea6"
const MESSAGE_RECEIVED_TOPIC0 = "0x74067246a35113666e7ea609db47ec0bceb8b77773497b430ca621d33584774f"
const ROUTER_MESSAGE_EXECUTED_TOPIC0 = "0x9b877de93ea9895756e337442c657f95a34fc68e7eb988bdfa693d5be83016b6"

const bytesToAscii = (bytes: Uint8Array): string => {
  let result = ""
  for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i])
  return result
}

const writeAuditRecord = (
  runtime: Runtime<Config>,
  auditRegistryWriteReceiverAddress: Address,
  depositId: `0x${string}`,
  depositNoticeHash: `0x${string}`,
  reserveAttestationHash: `0x${string}`,
  complianceDecisionHash: `0x${string}`,
  aiOutputHash: `0x${string}`,
  aiMemoSha256: `0x${string}`,
  aiInputSha256: `0x${string}`,
  aiModelHash: `0x${string}`,
  aiPromptVersionHash: `0x${string}`,
  aiConfidenceBps: number,
  aiCreatedAt: bigint,
  aiDecision: number,
  aiExternalRssSha256: `0x${string}`,
  aiExternalJsonSha256: `0x${string}`
) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const gasLimit = runtime.config.sepoliaWriteGasLimit ?? "800000"

  const writeData = encodeFunctionData({
    abi: AUDIT_REGISTRY_ABI,
    functionName: "record",
    args: [
      depositId,
      depositNoticeHash,
      reserveAttestationHash,
      complianceDecisionHash,
      aiOutputHash,
      [
        aiMemoSha256,
        aiInputSha256,
        aiModelHash,
        aiPromptVersionHash,
        aiExternalRssSha256,
        aiExternalJsonSha256,
      ],
      [BigInt(aiConfidenceBps), aiCreatedAt, BigInt(aiDecision)],
    ],
  })

  const report = runtime.report(prepareReportRequest(writeData)).result()
  return evmClient
    .writeReport(runtime, {
      receiver: auditRegistryWriteReceiverAddress,
      report,
      gasConfig: {
        gasLimit,
      },
    })
    .result()
}

const parseConfig = (configBytes: Uint8Array): Config => {
  return configSchema.parse(safeJsonParse(bytesToAscii(configBytes)))
}

const parseDepositPayload = (triggerOutput: HTTPPayload): DepositPayload => {
  const raw = bytesToAscii(triggerOutput.input)
  return depositSchema.parse(safeJsonParse(raw))
}

const fetchJsonText = (url: string) => (sendRequester: any) => {
  const response = sendRequester
    .sendRequest({
      url,
      method: "GET",
      headers: { accept: "application/json" },
    })
    .result()

  if (!ok(response)) {
    throw new Error(`HTTP request failed: url=${url} status=${response.statusCode}`)
  }

  return text(response)
}

const readFinalizedBlockNumber = (runtime: Runtime<Config>, evmClient: InstanceType<typeof cre.capabilities.EVMClient>) => {
  const reply = evmClient
    .headerByNumber(runtime, {
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  if (!reply.header?.blockNumber) throw new Error("missing_header_blockNumber")
  return protoBigIntToBigint(reply.header.blockNumber)
}

const readSenderConfig = (runtime: Runtime<Config>, senderAddress: Address) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const read = (functionName: "destinationChainSelector" | "destinationReceiver" | "operator" | "gasLimit" | "router") => {
    const callData = encodeFunctionData({
      abi: SENDER_ABI,
      functionName,
      args: [],
    })

    const contractCall = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: senderAddress,
          data: callData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: SENDER_ABI,
      functionName,
      data: bytesToHex(contractCall.data),
    })
  }

  return {
    destinationChainSelector: read("destinationChainSelector") as bigint,
    destinationReceiver: read("destinationReceiver") as Address,
    operator: read("operator") as Address,
    gasLimit: read("gasLimit") as bigint,
    router: read("router") as Address,
  }
}

const findSepoliaMessageId = (runtime: Runtime<Config>, senderAddress: Address, depositId: `0x${string}`) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const toBlock = readFinalizedBlockNumber(runtime, evmClient)
  const fromBlock = toBlock > 2_000n ? toBlock - 2_000n : 0n

  const reply = evmClient
    .filterLogs(runtime, {
      filterQuery: {
        fromBlock: blockNumber(fromBlock),
        toBlock: blockNumber(toBlock),
        addresses: [hexToBase64(senderAddress)],
        topics: [
          { topic: [hexToBase64(MESSAGE_SENT_TOPIC0)] },
          { topic: [] },
          { topic: [hexToBase64(depositId)] },
        ],
      },
    })
    .result()

  if (reply.logs.length === 0) {
    return {
      found: false as const,
      searchFrom: fromBlock,
      searchTo: toBlock,
    }
  }

  const log = reply.logs[reply.logs.length - 1]
  const messageId = bytesToHex(log.topics[1]) as `0x${string}`
  return {
    found: true as const,
    messageId,
    searchFrom: fromBlock,
    searchTo: toBlock,
    txHash: bytesToHex(log.txHash),
    blockNumber: log.blockNumber ? protoBigIntToBigint(log.blockNumber) : undefined,
  }
}

const findBaseMessageReceived = (runtime: Runtime<Config>, receiverAddress: Address, messageId: `0x${string}`) => {
  const destSelector = BigInt(runtime.config.destChainSelector)
  const evmClient = new cre.capabilities.EVMClient(destSelector)
  const toBlock = readFinalizedBlockNumber(runtime, evmClient)
  const fromBlock = toBlock > 8_000n ? toBlock - 8_000n : 0n

  const reply = evmClient
    .filterLogs(runtime, {
      filterQuery: {
        fromBlock: blockNumber(fromBlock),
        toBlock: blockNumber(toBlock),
        addresses: [hexToBase64(receiverAddress)],
        topics: [
          { topic: [hexToBase64(MESSAGE_RECEIVED_TOPIC0)] },
          { topic: [hexToBase64(messageId)] },
        ],
      },
    })
    .result()

  if (reply.logs.length === 0) {
    return {
      found: false as const,
      searchFrom: fromBlock,
      searchTo: toBlock,
    }
  }

  const log = reply.logs[reply.logs.length - 1]
  const depositId = bytesToHex(log.topics[2]) as `0x${string}`
  const to = ("0x" + bytesToHex(log.topics[3]).slice(-40)) as Address
  const amount = BigInt(bytesToHex(log.data))

  return {
    found: true as const,
    depositId,
    to,
    amount,
    txHash: bytesToHex(log.txHash),
    blockNumber: log.blockNumber ? protoBigIntToBigint(log.blockNumber) : undefined,
    searchFrom: fromBlock,
    searchTo: toBlock,
  }
}

const findBaseRouterMessageExecuted = (runtime: Runtime<Config>, routerAddress: Address, messageId: `0x${string}`) => {
  const destSelector = BigInt(runtime.config.destChainSelector)
  const evmClient = new cre.capabilities.EVMClient(destSelector)
  const toBlock = readFinalizedBlockNumber(runtime, evmClient)
  const fromBlock = toBlock > 8_000n ? toBlock - 8_000n : 0n

  const reply = evmClient
    .filterLogs(runtime, {
      filterQuery: {
        fromBlock: blockNumber(fromBlock),
        toBlock: blockNumber(toBlock),
        addresses: [hexToBase64(routerAddress)],
        topics: [
          { topic: [hexToBase64(ROUTER_MESSAGE_EXECUTED_TOPIC0)] },
        ],
      },
    })
    .result()

  if (reply.logs.length === 0) {
    return {
      found: false as const,
      searchFrom: fromBlock,
      searchTo: toBlock,
    }
  }

  for (const log of reply.logs) {
    const dataHex = bytesToHex(log.data)
    const dataMessageId = ("0x" + dataHex.slice(2, 66)) as `0x${string}`
    if (dataMessageId.toLowerCase() !== messageId.toLowerCase()) continue

    const sourceChainSelector = BigInt("0x" + dataHex.slice(66, 130))
    const offramp = ("0x" + dataHex.slice(154, 194)) as Address
    const commitment = ("0x" + dataHex.slice(194, 258)) as `0x${string}`

    return {
      found: true as const,
      sourceChainSelector,
      offramp,
      commitment,
      txHash: bytesToHex(log.txHash),
      blockNumber: log.blockNumber ? protoBigIntToBigint(log.blockNumber) : undefined,
      searchFrom: fromBlock,
      searchTo: toBlock,
    }
  }

  return {
    found: false as const,
    searchFrom: fromBlock,
    searchTo: toBlock,
  }
}

const readReceiverRouter = (runtime: Runtime<Config>, receiverAddress: Address) => {
  const destSelector = BigInt(runtime.config.destChainSelector)
  const evmClient = new cre.capabilities.EVMClient(destSelector)

  const callData = encodeFunctionData({
    abi: RECEIVER_ABI,
    functionName: "getRouter",
    args: [],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: receiverAddress,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  return decodeFunctionResult({
    abi: RECEIVER_ABI,
    functionName: "getRouter",
    data: bytesToHex(contractCall.data),
  }) as Address
}

const normalizeHex = (value: unknown): `0x${string}` | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") {
    if (value.startsWith("0x")) return value as `0x${string}`

    if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
      return `0x${value}` as `0x${string}`
    }

    const maybeBytes = base64ToBytes(value)
    if (maybeBytes) return bytesToHex(maybeBytes) as `0x${string}`

    return `0x${value}` as `0x${string}`
  }

  if (value instanceof Uint8Array) {
    return bytesToHex(value) as `0x${string}`
  }

  if (value instanceof ArrayBuffer) {
    return bytesToHex(new Uint8Array(value)) as `0x${string}`
  }

  if (Array.isArray(value) && value.every((nestedValue) => typeof nestedValue === "number")) {
    return bytesToHex(Uint8Array.from(value)) as `0x${string}`
  }

  return bytesToHex(value as Uint8Array) as `0x${string}`
}

const stringifyJsonValue = (value: unknown): string =>
  JSON.stringify(value, (_key, nestedValue) => (typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue))

const isHex32Value = (value: string): value is `0x${string}` => {
  if (value.length !== 66) return false
  if (!value.startsWith("0x")) return false

  for (let index = 2; index < value.length; index += 1) {
    const char = value[index]
    if (!char) return false
    const isDigit = char >= "0" && char <= "9"
    const isLowerHex = char >= "a" && char <= "f"
    if (!isDigit && !isLowerHex) return false
  }

  return true
}

const toArray = <T>(value: ArrayLike<T> | Iterable<T> | undefined | null): T[] => {
  if (!value) return []

  return Array.from(value)
}

const tryExtractMessageIdFromReceiptText = (
  receiptText: string,
  _senderAddress: Address,
  depositId: `0x${string}`,
) => {
  const receiptTextLc = receiptText.toLowerCase()
  const depositIdLc = depositId.toLowerCase()
  const messageSentSigLc = MESSAGE_SENT_TOPIC0.toLowerCase()

  if (!receiptTextLc.includes(messageSentSigLc)) return undefined
  if (!receiptTextLc.includes(depositIdLc)) return undefined

  const compactTopicPrefix = `"topics":["${messageSentSigLc}","`
  const compactDepositSuffix = `","${depositIdLc}"`

  let searchFrom = 0
  while (searchFrom < receiptTextLc.length) {
    const topicIndex = receiptTextLc.indexOf(compactTopicPrefix, searchFrom)
    if (topicIndex === -1) break

    const messageIdStart = topicIndex + compactTopicPrefix.length
    const depositIndex = receiptTextLc.indexOf(compactDepositSuffix, messageIdStart)
    if (depositIndex === -1) {
      searchFrom = topicIndex + compactTopicPrefix.length
      continue
    }

    const messageId = receiptTextLc.slice(messageIdStart, depositIndex)
    if (isHex32Value(messageId)) {
      return messageId
    }

    searchFrom = topicIndex + compactTopicPrefix.length
  }

  return undefined
}

const tryExtractMessageIdFromSepoliaReceipt = (
  runtime: Runtime<Config>,
  senderAddress: Address,
  depositId: `0x${string}`,
  txHashHex: `0x${string}`,
) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const reply = evmClient
    .getTransactionReceipt(runtime, {
      hash: hexToBase64(txHashHex),
    })
    .result()

  const receipt = reply.receipt
  if (!receipt) return undefined

  const rawReceiptText = stringifyJsonValue(receipt)
  const rawReceiptTextMatch = tryExtractMessageIdFromReceiptText(rawReceiptText, senderAddress, depositId)
  if (rawReceiptTextMatch) return rawReceiptTextMatch

  const receiptLogs = toArray(
    receipt.logs as
      | ArrayLike<{ address: unknown; topics?: ArrayLike<unknown> | Iterable<unknown> }>
      | Iterable<{ address: unknown; topics?: ArrayLike<unknown> | Iterable<unknown> }>
      | undefined,
  )
  const normalizedReceiptLogs = receiptLogs.map((log) => ({
    address: normalizeHex(log.address)?.toLowerCase() ?? "",
    topics: toArray(log.topics).map((topic) => normalizeHex(topic)?.toLowerCase() ?? ""),
  }))

  const receiptText = stringifyJsonValue(normalizedReceiptLogs)
  const receiptTextMatch = tryExtractMessageIdFromReceiptText(receiptText, senderAddress, depositId)
  if (receiptTextMatch) return receiptTextMatch

  const depositIdLc = depositId.toLowerCase()
  const messageSentSigLc = MESSAGE_SENT_TOPIC0.toLowerCase()

  for (const log of normalizedReceiptLogs) {
    const eventSigHex = log.topics.length > 0 ? log.topics[0] ?? "" : ""
    const depositTopicHex = log.topics.length > 2 ? log.topics[2] ?? "" : ""
    if (eventSigHex === messageSentSigLc && depositTopicHex === depositIdLc) {
      if (log.topics.length < 2) continue

      const messageId = log.topics[1] as `0x${string}` | undefined
      if (messageId) return messageId
    }

    const logJsonLc = stringifyJsonValue(log).toLowerCase()
    if (!logJsonLc.includes(messageSentSigLc)) continue
    if (!logJsonLc.includes(depositIdLc)) continue

    const topicMatch = tryExtractMessageIdFromReceiptText(logJsonLc, senderAddress, depositId)
    if (!topicMatch) continue

    return topicMatch
  }

  return undefined
}

const readRouterIsChainSupported = (runtime: Runtime<Config>) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const chainSelector = BigInt(runtime.config.destChainSelector)

  const callData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "isChainSupported",
    args: [chainSelector],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.sepoliaCcipRouterAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const supported = decodeFunctionResult({
    abi: ROUTER_ABI,
    functionName: "isChainSupported",
    data: bytesToHex(contractCall.data),
  }) as boolean

  return supported
}

const readIssuerUsedDepositId = (runtime: Runtime<Config>, issuerAddress: Address, depositId: `0x${string}`) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const callData = encodeFunctionData({
    abi: ISSUER_ABI,
    functionName: "usedDepositId",
    args: [depositId],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: issuerAddress,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  return decodeFunctionResult({
    abi: ISSUER_ABI,
    functionName: "usedDepositId",
    data: bytesToHex(contractCall.data),
  }) as boolean
}

const writeIssuerMint = (runtime: Runtime<Config>, issuerWriteReceiverAddress: Address, to: Address, amount: bigint, depositId: `0x${string}`) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const gasLimit = runtime.config.sepoliaWriteGasLimit ?? "800000"

  const writeData = encodeFunctionData({
    abi: ISSUER_ABI,
    functionName: "mint",
    args: [to, amount, depositId],
  })

  const report = runtime.report(prepareReportRequest(writeData)).result()
  return evmClient
    .writeReport(runtime, {
      receiver: issuerWriteReceiverAddress,
      report,
      gasConfig: {
        gasLimit,
      },
    })
    .result()
}

const readReceiverProcessedDepositId = (runtime: Runtime<Config>, receiverAddress: Address, depositId: `0x${string}`) => {
  const destSelector = BigInt(runtime.config.destChainSelector)
  const evmClient = new cre.capabilities.EVMClient(destSelector)

  const callData = encodeFunctionData({
    abi: RECEIVER_ABI,
    functionName: "processedDepositId",
    args: [depositId],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: receiverAddress,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  return decodeFunctionResult({
    abi: RECEIVER_ABI,
    functionName: "processedDepositId",
    data: bytesToHex(contractCall.data),
  }) as boolean
}

const readSenderEstimateFee = (runtime: Runtime<Config>, senderAddress: Address, to: Address, amount: bigint, depositId: `0x${string}`) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const callData = encodeFunctionData({
    abi: SENDER_ABI,
    functionName: "estimateFee",
    args: [to, amount, depositId],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: senderAddress,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  return decodeFunctionResult({
    abi: SENDER_ABI,
    functionName: "estimateFee",
    data: bytesToHex(contractCall.data),
  }) as bigint
}

const writeSenderSend = (runtime: Runtime<Config>, senderWriteReceiverAddress: Address, to: Address, amount: bigint, depositId: `0x${string}`) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sepoliaChainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${runtime.config.sepoliaChainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const gasLimit = runtime.config.sepoliaWriteGasLimit ?? "800000"

  const writeData = encodeFunctionData({
    abi: SENDER_ABI,
    functionName: "send",
    args: [to, amount, depositId],
  })

  const report = runtime.report(prepareReportRequest(writeData)).result()
  return evmClient
    .writeReport(runtime, {
      receiver: senderWriteReceiverAddress,
      report,
      gasConfig: {
        gasLimit,
      },
    })
    .result()
}

const onHttpTrigger = async (runtime: Runtime<Config>, triggerOutput: HTTPPayload) => {
  let deposit: DepositPayload
  try {
    deposit = parseDepositPayload(triggerOutput)
  } catch {
    runtime.log("blocked: reason=invalid_trigger_payload")
    return "blocked"
  }
  const http = new cre.capabilities.HTTPClient()
  const baseUrl = runtime.config.reserveApiBaseUrl.replace(/\/$/, "")
  const depositUrl = `${baseUrl}/deposits?depositId=${encodeURIComponent(deposit.depositId)}`
  const reservesUrl = `${baseUrl}/reserves`

  runtime.log(`stage=trigger_parsed depositId=${deposit.depositId} scenario=${deposit.scenario ?? ""}`)

  let dep: DepositApiResponse
  try {
    runtime.log(`stage=fetch_deposit_notice url=${depositUrl}`)
    const depText = http
      .sendRequest(
        runtime,
        fetchJsonText(depositUrl),
        consensusIdenticalAggregation()
      )()
      .result()

    dep = depositApiResponseSchema.parse(safeJsonParse(depText))
  } catch (e) {
    runtime.log(`blocked: reason=deposit_notice_unavailable error=${(e as Error).message}`)
    return "blocked"
  }

  if (dep.depositId.toLowerCase() !== deposit.depositId.toLowerCase()) {
    runtime.log("blocked: reason=deposit_notice_depositId_mismatch")
    return "blocked"
  }

  const to = dep.notice.onchain.to
  const amountWei = dep.notice.amountWei

  if (!dep.signature) {
    runtime.log("blocked: reason=deposit_notice_missing_signature")
    return "blocked"
  }

  const depositMessage = makeDepositNoticeMessage(dep.notice, dep.custodianAddress)
  const depositMessageHash = hashMessage(depositMessage)
  if (depositMessageHash.toLowerCase() !== dep.messageHash.toLowerCase()) {
    runtime.log("blocked: reason=deposit_notice_messageHash_mismatch")
    return "blocked"
  }

  let recoveredCustodian: string
  try {
    recoveredCustodian = await recoverAddress({
      hash: depositMessageHash,
      signature: dep.signature as `0x${string}`,
    })
  } catch (e) {
    runtime.log(`blocked: reason=deposit_notice_invalid_signature error=${(e as Error).message}`)
    return "blocked"
  }
  if (recoveredCustodian.toLowerCase() !== dep.custodianAddress.toLowerCase()) {
    runtime.log("blocked: reason=deposit_notice_invalid_signature")
    return "blocked"
  }

  const depositIdFromMessage = sha256(toBytes(depositMessage))
  if (depositIdFromMessage.toLowerCase() !== dep.depositId.toLowerCase()) {
    runtime.log("blocked: reason=deposit_notice_depositId_hash_mismatch")
    return "blocked"
  }

  const depositNoticeHashBytes32 = depositMessageHash as `0x${string}`

  runtime.log(`depositId=${deposit.depositId} to=${to} amount=${amountWei}`)

  let reserves: ReservesApiResponse
  try {
    runtime.log(`stage=fetch_reserves url=${reservesUrl}`)
    const reservesText = http
      .sendRequest(runtime, fetchJsonText(reservesUrl), consensusIdenticalAggregation())()
      .result()
    reserves = reservesApiResponseSchema.parse(safeJsonParse(reservesText))
  } catch (e) {
    runtime.log(`blocked: reason=reserves_unavailable error=${(e as Error).message}`)
    return "blocked"
  }

  const reservesMessage = makeReserveAttestationMessage(reserves)
  const reservesMessageHash = hashMessage(reservesMessage)
  if (reservesMessageHash.toLowerCase() !== reserves.messageHash.toLowerCase()) {
    runtime.log("blocked: reason=reserves_messageHash_mismatch")
    return "blocked"
  }

  let recoveredAuditor: string
  try {
    recoveredAuditor = await recoverAddress({
      hash: reservesMessageHash,
      signature: reserves.signature as `0x${string}`,
    })
  } catch (e) {
    runtime.log(`blocked: reason=reserves_invalid_signature error=${(e as Error).message}`)
    return "blocked"
  }
  if (recoveredAuditor.toLowerCase() !== reserves.auditor.toLowerCase()) {
    runtime.log("blocked: reason=reserves_invalid_signature")
    return "blocked"
  }

  const reserveAttestationHashBytes32 = reservesMessageHash as `0x${string}`

  if (reserves.auditor || reserves.proofRef || reserves.messageHash) {
    runtime.log(
      `reserves_evidence auditor=${reserves.auditor ?? ""} proofRef=${reserves.proofRef ?? ""} messageHash=${reserves.messageHash ?? ""}`
    )
  }

  const kycUrl = `${baseUrl}/policy/kyc?address=${to}`
  runtime.log(`stage=fetch_kyc url=${kycUrl}`)
  let kyc: KycApiResponse
  try {
    const kycText = http
      .sendRequest(runtime, fetchJsonText(kycUrl), consensusIdenticalAggregation())()
      .result()
    kyc = kycApiResponseSchema.parse(safeJsonParse(kycText))
  } catch (e) {
    runtime.log(`blocked: reason=kyc_unavailable error=${(e as Error).message}`)
    return "blocked"
  }

  const complianceMessage = [
    "GreenReserveComplianceDecision:v1",
    `address=${String(to).toLowerCase()}`,
    `isAllowed=${String(Boolean(kyc.isAllowed))}`,
    `reason=${String(kyc.reason ?? "")}`,
    `ruleId=${String(kyc.ruleId ?? "")}`,
    `checkedAt=${String((kyc as any)?.checkedAt ?? "")}`,
    `listVersion=${String((kyc as any)?.listVersion ?? "")}`,
    `evidenceListId=${String((kyc as any)?.evidence?.matchedList ?? (kyc as any)?.evidence?.primaryList ?? "")}`,
    `evidenceOfacSha256=${String((kyc as any)?.evidence?.lists?.ofac_sdn_advanced?.sha256 ?? "")}`,
    `evidenceEuSha256=${String((kyc as any)?.evidence?.lists?.eu_consolidated?.sha256 ?? "")}`,
    `evidenceUkSha256=${String((kyc as any)?.evidence?.lists?.uk_sanctions_list?.sha256 ?? "")}`,
    `evidenceSha256=${String((kyc as any)?.evidence?.sha256 ?? "")}`,
    `evidenceEtag=${String((kyc as any)?.evidence?.etag ?? "")}`,
    `evidenceLastModified=${String((kyc as any)?.evidence?.lastModified ?? "")}`,
    `evidenceSourceUrl=${String((kyc as any)?.evidence?.sourceUrl ?? "")}`,
  ].join("\n")
  const complianceDecisionHashBytes32 = keccak256(toBytes(complianceMessage))

  let ai: null | {
    memo: { riskScore: number; confidence: number; decision: string; reasons: string[] }
    createdAtMs: number
    memoSha256: string
    inputSha256: string
    model: string
    promptVersion: string
    externalRssSha256: string
    externalRssUrl: string
    externalJsonSha256: string
    externalJsonUrl: string
  } = null
  const aiUrl = `${baseUrl}/ai/risk-memo?depositId=${encodeURIComponent(deposit.depositId)}&to=${encodeURIComponent(
    to
  )}&amount=${encodeURIComponent(amountWei)}&reserveRatioBps=${encodeURIComponent(
    reserves.reserveRatioBps
  )}&kycAllowed=${encodeURIComponent(String(kyc.isAllowed))}&kycReason=${encodeURIComponent(kyc.reason ?? "")}`
  try {
    runtime.log(`stage=fetch_ai_risk_memo url=${aiUrl}`)
    const aiText = http
      .sendRequest(runtime, fetchJsonText(aiUrl), consensusIdenticalAggregation())()
      .result()
    const parsed = aiRiskMemoResponseSchema.parse(safeJsonParse(aiText))
    const external = parsed.external && typeof parsed.external === "object" ? parsed.external : null
    ai = {
      memo: parsed.memo,
      createdAtMs: parsed.createdAtMs ?? 0,
      memoSha256: parsed.memoSha256,
      inputSha256: parsed.inputSha256 ?? "",
      model: parsed.model ?? "",
      promptVersion: parsed.promptVersion ?? "",
      externalRssSha256: (external as any)?.rssSha256 ?? "",
      externalRssUrl: (external as any)?.rssUrl ?? "",
      externalJsonSha256: (external as any)?.jsonSha256 ?? "",
      externalJsonUrl: (external as any)?.jsonUrl ?? "",
    }
  } catch (e) {
    runtime.log(`blocked: reason=ai_unavailable error=${(e as Error).message}`)
    return "blocked"
  }

  const aiOutputHashBytes32 = (() => {
    if (!ai?.memoSha256 || !/^[0-9a-fA-F]{64}$/.test(ai.memoSha256)) return ZERO_BYTES32
    const msg = [
      "GreenReserveAiOutputCommit:v2",
      `depositId=${deposit.depositId.toLowerCase()}`,
      `memoSha256=${ai.memoSha256.toLowerCase()}`,
      `model=${String(ai.model ?? "")}`,
      `promptVersion=${String(ai.promptVersion ?? "")}`,
      `createdAtMs=${String(ai.createdAtMs ?? 0)}`,
      `inputSha256=${String(ai.inputSha256 ?? "")}`,
      `externalRssSha256=${String(ai.externalRssSha256 ?? "")}`,
      `externalRssUrl=${String(ai.externalRssUrl ?? "")}`,
      `externalJsonSha256=${String(ai.externalJsonSha256 ?? "")}`,
      `externalJsonUrl=${String(ai.externalJsonUrl ?? "")}`,
    ].join("\n")
    return sha256(toBytes(msg)) as `0x${string}`
  })()

  const aiMemoSha256Bytes32 = (() => {
    if (!ai?.memoSha256 || !/^[0-9a-fA-F]{64}$/.test(ai.memoSha256)) return ZERO_BYTES32
    return (`0x${ai.memoSha256.toLowerCase()}`) as `0x${string}`
  })()

  const aiInputSha256Bytes32 = (() => {
    if (!ai?.inputSha256 || !/^[0-9a-fA-F]{64}$/.test(ai.inputSha256)) return ZERO_BYTES32
    return (`0x${ai.inputSha256.toLowerCase()}`) as `0x${string}`
  })()

  const aiModelHashBytes32 = ai?.model ? (sha256(toBytes(ai.model)) as `0x${string}`) : ZERO_BYTES32
  const aiPromptVersionHashBytes32 = ai?.promptVersion ? (sha256(toBytes(ai.promptVersion)) as `0x${string}`) : ZERO_BYTES32
  const aiExternalRssSha256Bytes32 = (() => {
    if (!ai?.externalRssSha256 || !/^[0-9a-fA-F]{64}$/.test(ai.externalRssSha256)) return ZERO_BYTES32
    return (`0x${ai.externalRssSha256.toLowerCase()}`) as `0x${string}`
  })()
  const aiExternalJsonSha256Bytes32 = (() => {
    if (!ai?.externalJsonSha256 || !/^[0-9a-fA-F]{64}$/.test(ai.externalJsonSha256)) return ZERO_BYTES32
    return (`0x${ai.externalJsonSha256.toLowerCase()}`) as `0x${string}`
  })()
  const aiConfidenceBps = ai ? Math.max(0, Math.min(10_000, Math.round(ai.memo.confidence * 10_000))) : 0
  const aiCreatedAt = BigInt(ai && Number.isFinite(ai.createdAtMs) && ai.createdAtMs > 0 ? Math.floor(ai.createdAtMs / 1000) : 0)
  const aiDecision = ai?.memo.decision === "approve" ? 1 : ai?.memo.decision === "manual_review" ? 2 : ai?.memo.decision === "reject" ? 3 : 0

  let reserveRatioBps: bigint
  try {
    reserveRatioBps = BigInt(reserves.reserveRatioBps)
  } catch {
    runtime.log("blocked: reason=reserves_invalid_reserveRatioBps")
    return "blocked"
  }
  const isHealthy = reserveRatioBps >= 10_000n

  try {
    runtime.log("stage=read_router_support")
    const chainSupported = readRouterIsChainSupported(runtime)
    runtime.log(`sepoliaRouterSupportsDest=${chainSupported.toString()}`)
  } catch (e) {
    runtime.log(`sepoliaRouterSupportsDest_error=${(e as Error).message}`)
  }

  if (!kyc.isAllowed) {
    runtime.log(`blocked: reason=${kyc.reason ?? "kyc_denied"}`)
    return "blocked"
  }

  if (ai?.memo) {
    runtime.log(
      `ai_risk decision=${ai.memo.decision} riskScore=${ai.memo.riskScore} confidence=${ai.memo.confidence} memoSha256=${ai.memoSha256} model=${ai.model}`
    )
    if (ai.promptVersion || ai.externalRssSha256 || ai.externalRssUrl) {
      runtime.log(
        `ai_evidence promptVersion=${ai.promptVersion} createdAtMs=${ai.createdAtMs} externalRssSha256=${ai.externalRssSha256} externalRssUrl=${ai.externalRssUrl} externalJsonSha256=${ai.externalJsonSha256} externalJsonUrl=${ai.externalJsonUrl}`
      )
    }
    if (ai.memo.decision === "reject") {
      runtime.log("blocked: reason=ai_reject")
      return "blocked"
    }
    if (ai.memo.decision === "manual_review") {
      runtime.log("manual_review_required")
      return "manual_review_required"
    }
  }

  if (!isHealthy) {
    runtime.log(`insufficient_reserves: reserveRatioBps=${reserveRatioBps.toString()}`)
    return "insufficient_reserves"
  }

  runtime.log(`approved: reserveRatioBps=${reserveRatioBps.toString()}`)

  const auditRegistryAddress = runtime.config.sepoliaAuditRegistryAddress
  if (auditRegistryAddress) {
    const auditRegistryWriteReceiverAddress =
      runtime.config.sepoliaAuditRegistryWriteReceiverAddress || auditRegistryAddress

    runtime.log(`stage=write_audit receiver=${auditRegistryWriteReceiverAddress}`)
    const auditReply = writeAuditRecord(
      runtime,
      auditRegistryWriteReceiverAddress as Address,
      deposit.depositId as `0x${string}`,
      depositNoticeHashBytes32,
      reserveAttestationHashBytes32,
      complianceDecisionHashBytes32,
      aiOutputHashBytes32,
      aiMemoSha256Bytes32,
      aiInputSha256Bytes32,
      aiModelHashBytes32,
      aiPromptVersionHashBytes32,
      aiConfidenceBps,
      aiCreatedAt,
      aiDecision,
      aiExternalRssSha256Bytes32,
      aiExternalJsonSha256Bytes32
    )

    runtime.log(
      `audit_tx_status=${auditReply.txStatus.toString()} txHash=${auditReply.txHash ? bytesToHex(auditReply.txHash) : ""} error=${auditReply.errorMessage ?? ""}`
    )
    runtime.log(
      `audit_receiver_status=${auditReply.receiverContractExecutionStatus?.toString() ?? ""}`
    )

    if (
      auditReply.txStatus !== 2 ||
      (auditReply.receiverContractExecutionStatus !== undefined && auditReply.receiverContractExecutionStatus !== 0)
    ) {
      runtime.log("audit_failed_block")
      return "blocked"
    }
  }

  const issuerAddress = runtime.config.sepoliaIssuerAddress
  if (!issuerAddress) {
    runtime.log("approved_but_no_issuer_configured")
    return "approved"
  }

  runtime.log(`stage=read_issuer_used_depositId issuer=${issuerAddress}`)
  const used = readIssuerUsedDepositId(runtime, issuerAddress as Address, deposit.depositId as `0x${string}`)
  if (used) {
    runtime.log("mint_skipped_depositId_used")
  } else {
    const issuerWriteReceiverAddress = runtime.config.sepoliaIssuerWriteReceiverAddress || issuerAddress
    runtime.log(`stage=write_mint receiver=${issuerWriteReceiverAddress} to=${to} amount=${amountWei}`)
    const mintReply = writeIssuerMint(
      runtime,
      issuerWriteReceiverAddress as Address,
      to as Address,
      BigInt(amountWei),
      deposit.depositId as `0x${string}`
    )

    runtime.log(
      `mint_tx_status=${mintReply.txStatus.toString()} txHash=${mintReply.txHash ? bytesToHex(mintReply.txHash) : ""} error=${mintReply.errorMessage ?? ""}`
    )

    runtime.log(
      `mint_receiver_status=${mintReply.receiverContractExecutionStatus?.toString() ?? ""}`
    )

    if (mintReply.txStatus !== 2 || (mintReply.receiverContractExecutionStatus !== undefined && mintReply.receiverContractExecutionStatus !== 0)) {
      runtime.log("mint_failed_skip_ccip_send")
      return "approved"
    }
  }

  const senderAddress = runtime.config.sepoliaSenderAddress
  const senderWriteReceiverAddress = runtime.config.sepoliaSenderWriteReceiverAddress || senderAddress
  const receiverAddress = runtime.config.baseSepoliaReceiverAddress

  if (!senderAddress || !receiverAddress) {
    runtime.log("ccip_send_skipped_missing_sender_or_receiver")
    return "approved"
  }

  try {
    runtime.log(`stage=read_sender_config sender=${senderAddress}`)
    const senderConfig = readSenderConfig(runtime, senderAddress as Address)
    const expectedDestSelector = BigInt(runtime.config.destChainSelector)
    const expectedReceiver = receiverAddress as Address
    const expectedOperator = (senderWriteReceiverAddress as Address)
    const expectedRouter = runtime.config.sepoliaCcipRouterAddress as Address

    runtime.log(
      `ccip_sender_config onchain_router=${senderConfig.router} onchain_destChainSelector=${senderConfig.destinationChainSelector.toString()} onchain_destReceiver=${senderConfig.destinationReceiver} onchain_operator=${senderConfig.operator} onchain_gasLimit=${senderConfig.gasLimit.toString()}`
    )
    runtime.log(
      `ccip_sender_config expected_destChainSelector=${runtime.config.destChainSelector} expected_receiver=${receiverAddress}`
    )

    if (senderConfig.router.toLowerCase() !== expectedRouter.toLowerCase()) {
      runtime.log(
        `ccip_send_skipped_sender_config_mismatch: router onchain=${senderConfig.router} expected=${expectedRouter}`
      )
      return "approved"
    }

    if (senderConfig.destinationChainSelector !== expectedDestSelector) {
      runtime.log(
        `ccip_send_skipped_sender_config_mismatch: destChainSelector onchain=${senderConfig.destinationChainSelector.toString()} expected=${expectedDestSelector.toString()}`
      )
      return "approved"
    }

    if (senderConfig.destinationReceiver.toLowerCase() !== expectedReceiver.toLowerCase()) {
      runtime.log(
        `ccip_send_skipped_sender_config_mismatch: destReceiver onchain=${senderConfig.destinationReceiver} expected=${expectedReceiver}`
      )
      return "approved"
    }

    if (senderConfig.operator.toLowerCase() !== expectedOperator.toLowerCase()) {
      runtime.log(
        `ccip_send_skipped_sender_config_mismatch: operator onchain=${senderConfig.operator} expected=${expectedOperator}`
      )
      return "approved"
    }
  } catch (e) {
    runtime.log(`ccip_sender_config_error=${(e as Error).message}`)
  }

  runtime.log(`stage=read_receiver_processed_depositId receiver=${receiverAddress}`)
  const alreadyProcessed = readReceiverProcessedDepositId(runtime, receiverAddress as Address, deposit.depositId as `0x${string}`)
  if (alreadyProcessed) {
    runtime.log("ccip_send_skipped_already_processed")
    return "approved"
  }

  runtime.log(`stage=estimate_ccip_fee sender=${senderAddress} to=${to} amount=${amountWei}`)
  const fee = readSenderEstimateFee(
    runtime,
    senderAddress as Address,
    to as Address,
    BigInt(amountWei),
    deposit.depositId as `0x${string}`
  )
  runtime.log(`ccip_fee_wei=${fee.toString()}`)

  runtime.log(`stage=write_ccip_send receiver=${senderWriteReceiverAddress} to=${to} amount=${amountWei}`)
  const sendReply = writeSenderSend(
    runtime,
    senderWriteReceiverAddress as Address,
    to as Address,
    BigInt(amountWei),
    deposit.depositId as `0x${string}`
  )

  runtime.log(
    `ccip_tx_status=${sendReply.txStatus.toString()} txHash=${sendReply.txHash ? bytesToHex(sendReply.txHash) : ""} error=${sendReply.errorMessage ?? ""}`
  )

  runtime.log(
    `ccip_receiver_status=${sendReply.receiverContractExecutionStatus?.toString() ?? ""}`
  )

  if (sendReply.txStatus !== 2 || (sendReply.receiverContractExecutionStatus !== undefined && sendReply.receiverContractExecutionStatus !== 0)) {
    runtime.log("ccip_send_failed")
    return "approved"
  }

  try {
    runtime.log(`stage=read_post_send_processed_depositId receiver=${receiverAddress}`)
    const postProcessed = readReceiverProcessedDepositId(runtime, receiverAddress as Address, deposit.depositId as `0x${string}`)
    runtime.log(`ccip_post_send_processedDepositId=${postProcessed.toString()}`)
  } catch (e) {
    runtime.log(`ccip_post_send_processedDepositId_error=${(e as Error).message}`)
  }

  let messageId: `0x${string}` | undefined
  let receiptLookupAttempted = false
  try {
    runtime.log("stage=extract_message_id_from_receipt")
    const sendTxHashHex = (sendReply.txHash ? bytesToHex(sendReply.txHash) : undefined) as `0x${string}` | undefined
    if (sendTxHashHex) {
      receiptLookupAttempted = true
      messageId = tryExtractMessageIdFromSepoliaReceipt(
        runtime,
        senderAddress as Address,
        deposit.depositId as `0x${string}`,
        sendTxHashHex,
      )
      if (messageId) runtime.log(`ccip_messageId_from_receipt=${messageId}`)
    }
  } catch (e) {
    runtime.log(`ccip_messageId_receipt_error=${(e as Error).message}`)
  }

  if (!messageId) {
    if (receiptLookupAttempted) {
      runtime.log("ccip_messageId_receipt_unresolved")
    } else {
      try {
        runtime.log("stage=scan_message_id_from_logs")
        const scan = findSepoliaMessageId(runtime, senderAddress as Address, deposit.depositId as `0x${string}`)
        runtime.log(`ccip_messageId_scan_window=${scan.searchFrom.toString()}..${scan.searchTo.toString()}`)
        if (scan.found) {
          messageId = scan.messageId
          runtime.log(`ccip_messageId_from_scan=${messageId}`)
        } else {
          runtime.log("ccip_messageId_not_found")
        }
      } catch (e) {
        runtime.log(`ccip_messageId_scan_error=${(e as Error).message}`)
      }
    }
  }

  if (messageId) {
    let messageReceivedFound = false
    try {
      runtime.log(`stage=scan_base_message_received receiver=${receiverAddress} messageId=${messageId}`)
      const received = findBaseMessageReceived(runtime, receiverAddress as Address, messageId)
      runtime.log(`base_messageReceived_scan_window=${received.searchFrom.toString()}..${received.searchTo.toString()}`)
      if (received.found) {
        messageReceivedFound = true
        runtime.log(
          `base_messageReceived depositId=${received.depositId} to=${received.to} amount=${received.amount.toString()} txHash=${received.txHash} block=${received.blockNumber?.toString() ?? ""}`
        )
      } else {
        runtime.log("base_messageReceived_not_found")
      }
    } catch (e) {
      runtime.log(`base_messageReceived_error=${(e as Error).message}`)
    }

    if (!messageReceivedFound) {
      try {
        runtime.log(`stage=scan_base_router_message_executed receiver=${receiverAddress} messageId=${messageId}`)
        const baseRouter = readReceiverRouter(runtime, receiverAddress as Address)
        const executed = findBaseRouterMessageExecuted(runtime, baseRouter, messageId)
        runtime.log(`base_routerMessageExecuted_scan_window=${executed.searchFrom.toString()}..${executed.searchTo.toString()}`)
        if (executed.found) {
          runtime.log(
            `base_routerMessageExecuted sourceChainSelector=${executed.sourceChainSelector.toString()} offramp=${executed.offramp} commitment=${executed.commitment} txHash=${executed.txHash} block=${executed.blockNumber?.toString() ?? ""}`
          )
        } else {
          runtime.log("base_routerMessageExecuted_not_found")
        }
      } catch (e) {
        runtime.log(`base_routerMessageExecuted_error=${(e as Error).message}`)
      }
    }
  }

  return "approved"
}

const initWorkflow = () => {
  const httpTrigger = new cre.capabilities.HTTPCapability()

  return [
    cre.handler(
      httpTrigger.trigger({
        authorizedKeys: [],
      }),
      onHttpTrigger
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({
    configParser: parseConfig,
  })

  await runner.run(initWorkflow)
}
