import { NextResponse } from "next/server";

type DepositStageStatus = "unknown" | "pending" | "ok" | "bad";

type DepositStage = {
  id:
    | "DepositReceived"
    | "ReserveCheck"
    | "PolicyCheck"
    | "MintSepolia"
    | "CCIPSend"
    | "CCIPReceive"
    | "DestinationMint";
  status: DepositStageStatus;
  chain?: "sepolia" | "baseSepolia";
  txHash?: string;
  blockNumber?: number;
  confirmations?: number;
  messageId?: string;
  reason?: string;
};

type DerivedDepositStatusJson = {
  depositId: string;
  stages: DepositStage[];
  mintApproved?: {
    to: string;
    amount: string;
  };
  messageSent?: {
    messageId: string;
    to: string;
    amount: string;
  };
  messageReceived?: {
    messageId: string;
    to: string;
    amount: string;
  };
};

function isBytes32Hex(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function scenarioFromDepositId(depositId: string) {
  const last = depositId.toLowerCase().slice(-1);
  if (last === "1") return "insufficient-reserves" as const;
  if (last === "2") return "policy-blocked" as const;
  return "ok" as const;
}

export function GET(request: Request) {
  if (process.env.E2E_TEST !== "true") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const depositId = url.searchParams.get("depositId") ?? "";
  const messageIdHint = url.searchParams.get("messageIdHint") ?? "";

  if (!isBytes32Hex(depositId)) {
    return NextResponse.json({ error: "Invalid depositId" }, { status: 400 });
  }

  const scenario = scenarioFromDepositId(depositId);

  const to = "0x000000000000000000000000000000000000dEaD";
  const amount = "100";

  const reserveRatioBps =
    scenario === "insufficient-reserves" ? "9000" : "10000";
  const reserveStatus: DepositStageStatus =
    scenario === "insufficient-reserves" ? "bad" : "ok";

  const policyAllowed = scenario !== "policy-blocked";
  const policyStatus: DepositStageStatus = policyAllowed ? "ok" : "bad";

  const checksFailed = reserveStatus === "bad" || policyStatus === "bad";

  const mintStatus: DepositStageStatus = checksFailed ? "bad" : "ok";
  const sendStatus: DepositStageStatus = mintStatus === "ok" ? "ok" : "bad";
  const receiveStatus: DepositStageStatus = sendStatus === "ok" ? "ok" : "bad";
  const destinationStatus: DepositStageStatus =
    receiveStatus === "ok" ? "ok" : "bad";

  const messageId =
    isBytes32Hex(messageIdHint) && messageIdHint ? messageIdHint : depositId;

  const stages: DepositStage[] = [
    { id: "DepositReceived", status: "ok" },
    {
      id: "ReserveCheck",
      status: reserveStatus,
      reason: `reserveRatioBps=${reserveRatioBps}`,
    },
    {
      id: "PolicyCheck",
      status: policyStatus,
      reason: policyAllowed ? "allowed" : "blocked",
    },
    {
      id: "MintSepolia",
      status: mintStatus,
      chain: "sepolia",
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      blockNumber: 100,
      confirmations: 2,
      reason: checksFailed ? "Blocked by failed checks" : undefined,
    },
    {
      id: "CCIPSend",
      status: sendStatus,
      chain: "sepolia",
      txHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      blockNumber: 101,
      confirmations: 2,
      messageId,
      reason: sendStatus === "bad" ? "Blocked by previous stage" : undefined,
    },
    {
      id: "CCIPReceive",
      status: receiveStatus,
      chain: "baseSepolia",
      txHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      blockNumber: 200,
      confirmations: 2,
      messageId,
      reason: receiveStatus === "bad" ? "Blocked by previous stage" : undefined,
    },
    {
      id: "DestinationMint",
      status: destinationStatus,
      chain: "baseSepolia",
      txHash:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      blockNumber: 201,
      confirmations: 2,
      messageId,
      reason:
        destinationStatus === "bad" ? "Blocked by previous stage" : undefined,
    },
  ];

  const body: DerivedDepositStatusJson = {
    depositId,
    stages,
    mintApproved: checksFailed ? undefined : { to, amount },
    messageSent: sendStatus === "ok" ? { messageId, to, amount } : undefined,
    messageReceived:
      destinationStatus === "ok" ? { messageId, to, amount } : undefined,
  };

  return NextResponse.json(body);
}
