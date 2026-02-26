import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";

import { env } from "@/lib/env";

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
  | "ReserveCheckPassed"
  | "PolicyCheckPassed"
  | "MintSepoliaConfirmed"
  | "CCIPSendConfirmed"
  | "CCIPReceiveObserved";

export type DepositStage = {
  id: DepositStatusStageId;
  present: boolean;
  chain?: "sepolia" | "baseSepolia";
  txHash?: Hex;
  blockNumber?: bigint;
  messageId?: Hex;
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

  const stages: DepositStage[] = [
    { id: "DepositReceived", present: false },
    { id: "ReserveCheckPassed", present: false },
    { id: "PolicyCheckPassed", present: false },
    {
      id: "MintSepoliaConfirmed",
      present: Boolean(mint),
      chain: mint ? "sepolia" : undefined,
      txHash: mint?.transactionHash,
      blockNumber: mint?.blockNumber,
    },
    {
      id: "CCIPSendConfirmed",
      present: Boolean(sent),
      chain: sent ? "sepolia" : undefined,
      txHash: sent?.transactionHash,
      blockNumber: sent?.blockNumber,
      messageId: sent?.args.messageId,
    },
    {
      id: "CCIPReceiveObserved",
      present: Boolean(received),
      chain: received ? "baseSepolia" : undefined,
      txHash: received?.transactionHash,
      blockNumber: received?.blockNumber,
      messageId: received?.args.messageId,
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
