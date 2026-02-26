import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";

import { env } from "@/lib/env";
import { reserveApi } from "@/services/reserveApiClient";

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: env.NEXT_PUBLIC_SEPOLIA_RPC_URL
    ? http(env.NEXT_PUBLIC_SEPOLIA_RPC_URL)
    : http(),
});

const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL
    ? http(env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL)
    : http(),
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

export async function deriveDepositStatus(params: {
  depositId: Hex;
}): Promise<DerivedDepositStatus> {
  const reservePromise = reserveApi.reserves().catch(() => null);

  const toBlockSepolia = await sepoliaClient.getBlockNumber();
  const toBlockBase = await baseSepoliaClient.getBlockNumber();

  const fromBlockSepolia = clampFromBlock(
    toBlockSepolia,
    env.NEXT_PUBLIC_LOG_LOOKBACK_BLOCKS,
  );
  const fromBlockBase = clampFromBlock(
    toBlockBase,
    env.NEXT_PUBLIC_LOG_LOOKBACK_BLOCKS,
  );

  const [mintLogs, sentLogs, receivedLogs] = await Promise.all([
    sepoliaClient.getLogs({
      address: env.NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS as Address,
      event: MINT_APPROVED_EVENT,
      args: {
        depositId: params.depositId,
      },
      fromBlock: fromBlockSepolia,
      toBlock: toBlockSepolia,
    }),
    sepoliaClient.getLogs({
      address: env.NEXT_PUBLIC_SEPOLIA_SENDER_ADDRESS as Address,
      event: MESSAGE_SENT_EVENT,
      args: {
        depositId: params.depositId,
      },
      fromBlock: fromBlockSepolia,
      toBlock: toBlockSepolia,
    }),
    baseSepoliaClient.getLogs({
      address: env.NEXT_PUBLIC_BASE_SEPOLIA_RECEIVER_ADDRESS as Address,
      event: MESSAGE_RECEIVED_EVENT,
      args: {
        depositId: params.depositId,
      },
      fromBlock: fromBlockBase,
      toBlock: toBlockBase,
    }),
  ]);

  const mint = mintLogs[mintLogs.length - 1];
  const sent = sentLogs[sentLogs.length - 1];
  const received = receivedLogs[receivedLogs.length - 1];

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

  const mintStageStatus: DepositStageStatus = mint
    ? "ok"
    : checksFailed
      ? "bad"
      : "pending";

  const sendStageStatus: DepositStageStatus = sent
    ? "ok"
    : mintStageStatus === "bad"
      ? "bad"
      : "pending";

  const receiveStageStatus: DepositStageStatus = received
    ? "ok"
    : sendStageStatus === "bad"
      ? "bad"
      : "pending";

  const destinationMintStatus: DepositStageStatus = received
    ? "ok"
    : receiveStageStatus === "bad"
      ? "bad"
      : "pending";

  const stages: DepositStage[] = [
    { id: "DepositReceived", status: "ok" },
    {
      id: "ReserveCheck",
      status: reserveCheckStatus,
      reason: reserveState
        ? `reserveRatioBps=${reserveState.reserveRatioBps}`
        : undefined,
    },
    {
      id: "PolicyCheck",
      status: policyCheckStatus,
      reason: policyDecision?.reason,
    },
    {
      id: "MintSepolia",
      status: mintStageStatus,
      chain: mint ? "sepolia" : undefined,
      txHash: mint?.transactionHash,
      blockNumber: mint?.blockNumber,
      reason:
        mintStageStatus === "bad" ? "Blocked by failed checks" : undefined,
    },
    {
      id: "CCIPSend",
      status: sendStageStatus,
      chain: sent ? "sepolia" : undefined,
      txHash: sent?.transactionHash,
      blockNumber: sent?.blockNumber,
      messageId: sent?.args.messageId,
      reason:
        sendStageStatus === "bad" ? "Blocked by previous stage" : undefined,
    },
    {
      id: "CCIPReceive",
      status: receiveStageStatus,
      chain: received ? "baseSepolia" : undefined,
      txHash: received?.transactionHash,
      blockNumber: received?.blockNumber,
      messageId: received?.args.messageId,
      reason:
        receiveStageStatus === "bad" ? "Blocked by previous stage" : undefined,
    },
    {
      id: "DestinationMint",
      status: destinationMintStatus,
      chain: received ? "baseSepolia" : undefined,
      txHash: received?.transactionHash,
      blockNumber: received?.blockNumber,
      messageId: received?.args.messageId,
      reason:
        destinationMintStatus === "bad"
          ? "Blocked by previous stage"
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
