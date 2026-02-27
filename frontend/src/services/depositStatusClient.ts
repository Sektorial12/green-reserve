import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";

import { env } from "@/lib/env";
import { reserveApi } from "@/services/reserveApiClient";

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(env.NEXT_PUBLIC_SEPOLIA_RPC_URL, {
    timeout: 10_000,
    retryCount: 2,
    retryDelay: 1_000,
  }),
});

const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL, {
    timeout: 10_000,
    retryCount: 2,
    retryDelay: 1_000,
  }),
});

const MINT_APPROVED_EVENT = parseAbiItem(
  "event MintApproved(bytes32 indexed depositId, address indexed to, uint256 amount)",
);

const MESSAGE_SENT_EVENT = parseAbiItem(
  "event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed to, uint256 amount)",
);

const MESSAGE_RECEIVED_EVENT = parseAbiItem(
  "event MessageReceived(bytes32 indexed messageId, bytes32 indexed depositId, address indexed to, uint256 amount)",
);

const ROUTER_MESSAGE_EXECUTED_EVENT = parseAbiItem(
  "event MessageExecuted(bytes32 messageId, uint64 sourceChainSelector, address offRamp, bytes32 calldataHash)",
);

const ISSUER_ABI = parseAbi([
  "function usedDepositId(bytes32 depositId) view returns (bool)",
]);

const RECEIVER_ABI = parseAbi(["function getRouter() view returns (address)"]);

export type DepositStatusStageId =
  | "DepositReceived"
  | "ReserveCheck"
  | "PolicyCheck"
  | "MintSepolia"
  | "CCIPSend"
  | "CCIPReceive"
  | "DestinationMint";

export type DepositStageStatus = "unknown" | "pending" | "ok" | "bad";

export type DepositStage = {
  id: DepositStatusStageId;
  status: DepositStageStatus;
  chain?: "sepolia" | "baseSepolia";
  txHash?: Hex;
  blockNumber?: bigint;
  confirmations?: bigint;
  messageId?: Hex;
  reason?: string;
};

export type DerivedDepositStatus = {
  depositId: Hex;
  stages: DepositStage[];
  mintApproved?: {
    to: Address;
    amount: bigint;
  };
  messageSent?: {
    messageId: Hex;
    to: Address;
    amount: bigint;
  };
  messageReceived?: {
    messageId: Hex;
    to: Address;
    amount: bigint;
  };
};

function clampFromBlock(toBlock: bigint, lookbackBlocks: number) {
  const lookback = BigInt(lookbackBlocks);
  if (toBlock <= lookback) return BigInt(0);
  return toBlock - lookback;
}

function confirmationsFromBlock(params: {
  latestBlock?: bigint | null;
  blockNumber?: bigint;
}): bigint | undefined {
  if (params.latestBlock === undefined || params.latestBlock === null)
    return undefined;
  if (params.blockNumber === undefined) return undefined;
  if (params.latestBlock < params.blockNumber) return BigInt(0);
  return params.latestBlock - params.blockNumber + BigInt(1);
}

export async function deriveDepositStatus(params: {
  depositId: Hex;
  messageIdHint?: Hex;
}): Promise<DerivedDepositStatus> {
  const MIN_SEPOLIA_CONFIRMATIONS = BigInt(2);
  const MIN_BASE_SEPOLIA_CONFIRMATIONS = BigInt(2);

  const reservePromise = reserveApi.reserves().catch(() => null);

  const [toBlockSepolia, toBlockBase] = await Promise.all([
    sepoliaClient.getBlockNumber().catch(() => null),
    baseSepoliaClient.getBlockNumber().catch(() => null),
  ]);

  const sepoliaRpcOk = toBlockSepolia !== null;
  const baseRpcOk = toBlockBase !== null;

  const fromBlockSepolia = sepoliaRpcOk
    ? clampFromBlock(toBlockSepolia, env.NEXT_PUBLIC_LOG_LOOKBACK_BLOCKS)
    : null;
  const fromBlockBase = baseRpcOk
    ? clampFromBlock(toBlockBase, env.NEXT_PUBLIC_LOG_LOOKBACK_BLOCKS)
    : null;

  const [mintLogs, sentLogs, receivedLogs] = await Promise.all([
    sepoliaRpcOk && fromBlockSepolia !== null
      ? sepoliaClient
          .getLogs({
            address: env.NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS as Address,
            event: MINT_APPROVED_EVENT,
            args: {
              depositId: params.depositId,
            },
            fromBlock: fromBlockSepolia,
            toBlock: toBlockSepolia,
          })
          .catch(() => [])
      : Promise.resolve([]),
    sepoliaRpcOk && fromBlockSepolia !== null
      ? sepoliaClient
          .getLogs({
            address: env.NEXT_PUBLIC_SEPOLIA_SENDER_ADDRESS as Address,
            event: MESSAGE_SENT_EVENT,
            args: {
              depositId: params.depositId,
            },
            fromBlock: fromBlockSepolia,
            toBlock: toBlockSepolia,
          })
          .catch(() => [])
      : Promise.resolve([]),
    baseRpcOk && fromBlockBase !== null
      ? baseSepoliaClient
          .getLogs({
            address: env.NEXT_PUBLIC_BASE_SEPOLIA_RECEIVER_ADDRESS as Address,
            event: MESSAGE_RECEIVED_EVENT,
            args: {
              depositId: params.depositId,
            },
            fromBlock: fromBlockBase,
            toBlock: toBlockBase,
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const mint = mintLogs[mintLogs.length - 1];
  const sent = sentLogs[sentLogs.length - 1];
  const received = receivedLogs[receivedLogs.length - 1];

  const issuerUsedDepositId =
    sepoliaRpcOk && toBlockSepolia !== null
      ? await sepoliaClient
          .readContract({
            address: env.NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS as Address,
            abi: ISSUER_ABI,
            functionName: "usedDepositId",
            args: [params.depositId],
          })
          .catch(() => null)
      : null;

  const reserveState = await reservePromise;
  const reserveRatioBps = reserveState?.reserveRatioBps ?? null;
  const reserveRatioNum = reserveRatioBps
    ? Number.parseInt(reserveRatioBps, 10)
    : null;
  const reserveRatioOk =
    reserveRatioNum !== null &&
    Number.isFinite(reserveRatioNum) &&
    reserveRatioNum >= 10_000;
  const reserveCheckStatus: DepositStageStatus = reserveState
    ? reserveRatioOk
      ? "ok"
      : "bad"
    : "unknown";

  const policyAddress =
    mint?.args?.to ?? sent?.args?.to ?? received?.args?.to ?? null;
  const policyDecision = policyAddress
    ? await reserveApi.policyKyc(policyAddress).catch(() => null)
    : null;
  const policyCheckStatus: DepositStageStatus = policyDecision
    ? policyDecision.isAllowed
      ? "ok"
      : "bad"
    : "unknown";

  const checksFailed =
    reserveCheckStatus === "bad" || policyCheckStatus === "bad";

  const mintConfirmations = mint
    ? confirmationsFromBlock({
        latestBlock: toBlockSepolia,
        blockNumber: mint.blockNumber,
      })
    : undefined;
  const mintFinal =
    mintConfirmations !== undefined &&
    mintConfirmations >= MIN_SEPOLIA_CONFIRMATIONS;
  const mintObserved = Boolean(mint) || issuerUsedDepositId === true;

  const mintStageStatus: DepositStageStatus = mint
    ? mintFinal
      ? "ok"
      : "pending"
    : mintObserved
      ? "ok"
      : checksFailed
        ? "bad"
        : !sepoliaRpcOk
          ? "unknown"
          : "pending";

  const sentConfirmations = sent
    ? confirmationsFromBlock({
        latestBlock: toBlockSepolia,
        blockNumber: sent.blockNumber,
      })
    : undefined;
  const sentFinal =
    sentConfirmations !== undefined &&
    sentConfirmations >= MIN_SEPOLIA_CONFIRMATIONS;

  const sendStageStatus: DepositStageStatus = sent
    ? sentFinal
      ? "ok"
      : "pending"
    : mintStageStatus === "bad"
      ? "bad"
      : !sepoliaRpcOk
        ? "unknown"
        : "pending";

  const messageId = sent?.args?.messageId ?? params.messageIdHint;

  const routerExecutedLog =
    messageId && baseRpcOk && toBlockBase !== null
      ? await (async () => {
          const routerAddress = await baseSepoliaClient.readContract({
            address: env.NEXT_PUBLIC_BASE_SEPOLIA_RECEIVER_ADDRESS as Address,
            abi: RECEIVER_ABI,
            functionName: "getRouter",
          });

          const routerFromBlock = clampFromBlock(
            toBlockBase,
            Math.min(env.NEXT_PUBLIC_LOG_LOOKBACK_BLOCKS, 20_000),
          );

          const logs = await baseSepoliaClient.getLogs({
            address: routerAddress as Address,
            event: ROUTER_MESSAGE_EXECUTED_EVENT,
            fromBlock: routerFromBlock,
            toBlock: toBlockBase,
          });

          const matched = logs.filter(
            (l) =>
              l.args.messageId &&
              l.args.messageId.toLowerCase() === messageId.toLowerCase(),
          );

          return matched[matched.length - 1];
        })().catch(() => undefined)
      : undefined;

  const receiveLog = routerExecutedLog ?? received;
  const receiveConfirmations = receiveLog
    ? confirmationsFromBlock({
        latestBlock: toBlockBase,
        blockNumber: receiveLog.blockNumber,
      })
    : undefined;
  const receiveFinal =
    receiveConfirmations !== undefined &&
    receiveConfirmations >= MIN_BASE_SEPOLIA_CONFIRMATIONS;

  const receiveStageStatus: DepositStageStatus = receiveLog
    ? receiveFinal
      ? "ok"
      : "pending"
    : sendStageStatus === "bad"
      ? "bad"
      : !baseRpcOk
        ? "unknown"
        : messageId
          ? "pending"
          : "unknown";

  const receivedConfirmations = received
    ? confirmationsFromBlock({
        latestBlock: toBlockBase,
        blockNumber: received.blockNumber,
      })
    : undefined;
  const receivedFinal =
    receivedConfirmations !== undefined &&
    receivedConfirmations >= MIN_BASE_SEPOLIA_CONFIRMATIONS;

  const destinationMintStatus: DepositStageStatus = received
    ? receivedFinal
      ? "ok"
      : "pending"
    : receiveStageStatus === "bad"
      ? "bad"
      : !baseRpcOk
        ? "unknown"
        : receiveStageStatus === "unknown"
          ? "unknown"
          : "pending";

  const stages: DepositStage[] = [
    { id: "DepositReceived", status: "ok" },
    {
      id: "ReserveCheck",
      status: reserveCheckStatus,
      reason: reserveState
        ? `reserveRatioBps=${reserveState.reserveRatioBps}`
        : "Reserve API unavailable",
    },
    {
      id: "PolicyCheck",
      status: policyCheckStatus,
      reason: policyDecision?.reason
        ? policyDecision.reason
        : policyAddress
          ? "Policy API unavailable"
          : undefined,
    },
    {
      id: "MintSepolia",
      status: mintStageStatus,
      chain: mint || issuerUsedDepositId ? "sepolia" : undefined,
      txHash: mint?.transactionHash,
      blockNumber: mint?.blockNumber,
      confirmations: mintConfirmations,
      reason:
        mintStageStatus === "bad"
          ? "Blocked by failed checks"
          : mintStageStatus === "pending" && mint && !mintFinal
            ? `Waiting for confirmations (${mintConfirmations?.toString() ?? "0"}/${MIN_SEPOLIA_CONFIRMATIONS.toString()})`
            : issuerUsedDepositId && !mint
              ? "DepositId already used (issuer contract state)"
              : !sepoliaRpcOk
                ? "Sepolia RPC unavailable"
                : undefined,
    },
    {
      id: "CCIPSend",
      status: sendStageStatus,
      chain: sent ? "sepolia" : undefined,
      txHash: sent?.transactionHash,
      blockNumber: sent?.blockNumber,
      confirmations: sentConfirmations,
      messageId: sent?.args.messageId ?? params.messageIdHint,
      reason:
        sendStageStatus === "bad"
          ? "Blocked by previous stage"
          : sendStageStatus === "pending" && sent && !sentFinal
            ? `Waiting for confirmations (${sentConfirmations?.toString() ?? "0"}/${MIN_SEPOLIA_CONFIRMATIONS.toString()})`
            : !sepoliaRpcOk
              ? "Sepolia RPC unavailable"
              : undefined,
    },
    {
      id: "CCIPReceive",
      status: receiveStageStatus,
      chain: routerExecutedLog || received ? "baseSepolia" : undefined,
      txHash: routerExecutedLog?.transactionHash ?? received?.transactionHash,
      blockNumber: routerExecutedLog?.blockNumber ?? received?.blockNumber,
      confirmations: receiveConfirmations,
      messageId: messageId,
      reason:
        receiveStageStatus === "bad"
          ? "Blocked by previous stage"
          : receiveStageStatus === "pending" && receiveLog && !receiveFinal
            ? `Waiting for confirmations (${receiveConfirmations?.toString() ?? "0"}/${MIN_BASE_SEPOLIA_CONFIRMATIONS.toString()})`
            : !baseRpcOk
              ? "Base Sepolia RPC unavailable"
              : undefined,
    },
    {
      id: "DestinationMint",
      status: destinationMintStatus,
      chain: received ? "baseSepolia" : undefined,
      txHash: received?.transactionHash,
      blockNumber: received?.blockNumber,
      confirmations: receivedConfirmations,
      messageId: received?.args.messageId ?? params.messageIdHint,
      reason:
        destinationMintStatus === "bad"
          ? "Blocked by previous stage"
          : destinationMintStatus === "pending" && received && !receivedFinal
            ? `Waiting for confirmations (${receivedConfirmations?.toString() ?? "0"}/${MIN_BASE_SEPOLIA_CONFIRMATIONS.toString()})`
            : !baseRpcOk
              ? "Base Sepolia RPC unavailable"
              : receiveStageStatus === "ok" && !received
                ? "Router executed but receiver did not emit MessageReceived"
                : undefined,
    },
  ];

  const mintApproved =
    mint?.args?.to && mint.args.amount !== undefined
      ? {
          to: mint.args.to,
          amount: mint.args.amount,
        }
      : undefined;

  const messageSent =
    sent?.args?.messageId && sent.args.to && sent.args.amount !== undefined
      ? {
          messageId: sent.args.messageId,
          to: sent.args.to,
          amount: sent.args.amount,
        }
      : undefined;

  const messageReceived =
    received?.args?.messageId &&
    received.args.to &&
    received.args.amount !== undefined
      ? {
          messageId: received.args.messageId,
          to: received.args.to,
          amount: received.args.amount,
        }
      : undefined;

  return {
    depositId: params.depositId,
    stages,
    mintApproved,
    messageSent,
    messageReceived,
  };
}
