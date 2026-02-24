import {
  Runner,
  bytesToHex,
  consensusIdenticalAggregation,
  cre,
  encodeCallMsg,
  getNetwork,
  ok,
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
  sepoliaTokenAAddress: z.string().optional(),
  sepoliaIssuerAddress: z.string().optional(),
  sepoliaSenderAddress: z.string().optional(),
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
