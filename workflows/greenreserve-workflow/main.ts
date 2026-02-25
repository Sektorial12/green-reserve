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
  parseAbi,
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
  baseSepoliaTokenBAddress: z.string().optional(),
  baseSepoliaReceiverAddress: z.string().optional(),
})

type Config = z.infer<typeof configSchema>

const depositSchema = z.object({
  depositId: z.string(),
  to: z.string(),
  amount: z.string(),
  scenario: z.enum(["healthy", "unhealthy"]).optional(),
})

type DepositPayload = z.infer<typeof depositSchema>

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

const MESSAGE_SENT_TOPIC0 = "0xaf252146b623abbfc7d709584e656c80ec1b71e27d4a23ee2f8d1391caaddea6"
const MESSAGE_RECEIVED_TOPIC0 = "0x74067246a35113666e7ea609db47ec0bceb8b77773497b430ca621d33584774f"
const ROUTER_MESSAGE_EXECUTED_TOPIC0 = "0x9b877de93ea9895756e337442c657f95a34fc68e7eb988bdfa693d5be83016b6"

const bytesToAscii = (bytes: Uint8Array): string => {
  let result = ""
  for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i])
  return result
}

const parseConfig = (configBytes: Uint8Array): Config => {
  const parsed = JSON.parse(bytesToAscii(configBytes))
  return configSchema.parse(parsed)
}

const parseDepositPayload = (triggerOutput: HTTPPayload): DepositPayload => {
  const raw = bytesToAscii(triggerOutput.input)
  const parsed = JSON.parse(raw)
  return depositSchema.parse(parsed)
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

const tryExtractMessageIdFromSepoliaReceipt = (runtime: Runtime<Config>, senderAddress: Address, txHashHex: `0x${string}`) => {
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

  const senderAddressLc = senderAddress.toLowerCase()
  const messageSentSigLc = MESSAGE_SENT_TOPIC0.toLowerCase()

  for (const log of receipt.logs) {
    const addressHex = bytesToHex(log.address).toLowerCase()
    const eventSigHex = bytesToHex(log.eventSig).toLowerCase()
    if (addressHex !== senderAddressLc) continue
    if (eventSigHex !== messageSentSigLc) continue
    if (log.topics.length < 3) continue

    const messageId = bytesToHex(log.topics[1]) as `0x${string}`
    return messageId
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

const onHttpTrigger = (runtime: Runtime<Config>, triggerOutput: HTTPPayload) => {
  const deposit = parseDepositPayload(triggerOutput)
  runtime.log(`depositId=${deposit.depositId} to=${deposit.to} amount=${deposit.amount}`)

  const http = new cre.capabilities.HTTPClient()
  const baseUrl = runtime.config.reserveApiBaseUrl.replace(/\/$/, "")
  const scenario = deposit.scenario ?? "healthy"

  const reservesText = http
    .sendRequest(runtime, fetchJsonText(`${baseUrl}/reserves?scenario=${scenario}`), consensusIdenticalAggregation())()
    .result()
  const reserves = JSON.parse(reservesText) as {
    reserveRatioBps: string
  }

  const kycText = http
    .sendRequest(runtime, fetchJsonText(`${baseUrl}/policy/kyc?address=${deposit.to}`), consensusIdenticalAggregation())()
    .result()
  const kyc = JSON.parse(kycText) as { isAllowed: boolean; reason: string }

  const reserveRatioBps = BigInt(reserves.reserveRatioBps)
  const isHealthy = reserveRatioBps >= 10_000n

  const chainSupported = readRouterIsChainSupported(runtime)
  runtime.log(`sepoliaRouterSupportsDest=${chainSupported.toString()}`)

  if (!kyc.isAllowed) {
    runtime.log(`blocked: reason=${kyc.reason}`)
    return "blocked"
  }

  if (!isHealthy) {
    runtime.log(`insufficient_reserves: reserveRatioBps=${reserveRatioBps.toString()}`)
    return "insufficient_reserves"
  }

  runtime.log(`approved: reserveRatioBps=${reserveRatioBps.toString()}`)

  const issuerAddress = runtime.config.sepoliaIssuerAddress
  if (!issuerAddress) {
    runtime.log("approved_but_no_issuer_configured")
    return "approved"
  }

  const used = readIssuerUsedDepositId(runtime, issuerAddress as Address, deposit.depositId as `0x${string}`)
  if (used) {
    runtime.log("mint_skipped_depositId_used")
    return "approved"
  }

  const issuerWriteReceiverAddress = runtime.config.sepoliaIssuerWriteReceiverAddress || issuerAddress
  const mintReply = writeIssuerMint(
    runtime,
    issuerWriteReceiverAddress as Address,
    deposit.to as Address,
    BigInt(deposit.amount),
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

  const senderAddress = runtime.config.sepoliaSenderAddress
  const senderWriteReceiverAddress = runtime.config.sepoliaSenderWriteReceiverAddress || senderAddress
  const receiverAddress = runtime.config.baseSepoliaReceiverAddress

  if (!senderAddress || !receiverAddress) {
    runtime.log("ccip_send_skipped_missing_sender_or_receiver")
    return "approved"
  }

  try {
    const senderConfig = readSenderConfig(runtime, senderAddress as Address)
    runtime.log(
      `ccip_sender_config onchain_router=${senderConfig.router} onchain_destChainSelector=${senderConfig.destinationChainSelector.toString()} onchain_destReceiver=${senderConfig.destinationReceiver} onchain_operator=${senderConfig.operator} onchain_gasLimit=${senderConfig.gasLimit.toString()}`
    )
    runtime.log(
      `ccip_sender_config expected_destChainSelector=${runtime.config.destChainSelector} expected_receiver=${receiverAddress}`
    )
  } catch (e) {
    runtime.log(`ccip_sender_config_error=${(e as Error).message}`)
  }

  const alreadyProcessed = readReceiverProcessedDepositId(runtime, receiverAddress as Address, deposit.depositId as `0x${string}`)
  if (alreadyProcessed) {
    runtime.log("ccip_send_skipped_already_processed")
    return "approved"
  }

  const fee = readSenderEstimateFee(
    runtime,
    senderAddress as Address,
    deposit.to as Address,
    BigInt(deposit.amount),
    deposit.depositId as `0x${string}`
  )
  runtime.log(`ccip_fee_wei=${fee.toString()}`)

  const sendReply = writeSenderSend(
    runtime,
    senderWriteReceiverAddress as Address,
    deposit.to as Address,
    BigInt(deposit.amount),
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
    const postProcessed = readReceiverProcessedDepositId(runtime, receiverAddress as Address, deposit.depositId as `0x${string}`)
    runtime.log(`ccip_post_send_processedDepositId=${postProcessed.toString()}`)
  } catch (e) {
    runtime.log(`ccip_post_send_processedDepositId_error=${(e as Error).message}`)
  }

  let messageId: `0x${string}` | undefined
  try {
    const sendTxHashHex = (sendReply.txHash ? bytesToHex(sendReply.txHash) : undefined) as `0x${string}` | undefined
    if (sendTxHashHex) {
      messageId = tryExtractMessageIdFromSepoliaReceipt(runtime, senderAddress as Address, sendTxHashHex)
      if (messageId) runtime.log(`ccip_messageId_from_receipt=${messageId}`)
    }
  } catch (e) {
    runtime.log(`ccip_messageId_receipt_error=${(e as Error).message}`)
  }

  if (!messageId) {
    try {
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

  if (messageId) {
    let messageReceivedFound = false
    try {
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
