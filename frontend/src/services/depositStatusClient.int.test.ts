import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { baseSepolia, sepolia } from "viem/chains";

const server = setupServer(
  http.get("http://reserve.test/reserves", () => {
    return HttpResponse.json({
      asOfTimestamp: 0,
      scenario: "default",
      totalReservesUsd: "100",
      totalLiabilitiesUsd: "100",
      reserveRatioBps: "10000",
      proofRef: "proof",
    });
  }),
  http.get("http://reserve.test/policy/kyc", ({ request }) => {
    const url = new URL(request.url);
    const address = url.searchParams.get("address") ?? "";
    return HttpResponse.json({
      address,
      isAllowed: true,
      reason: "allowed",
    });
  }),
);

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
  };
});

describe("depositStatusClient integration", () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
  });

  afterEach(() => {
    server.resetHandlers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    server.close();
  });

  it("derives status from mocked RPC + mocked reserve API", async () => {
    process.env.NEXT_PUBLIC_RESERVE_API_BASE_URL = "http://reserve.test";

    const depositId = `0x${"11".repeat(32)}` as const;
    const messageId = `0x${"22".repeat(32)}` as const;
    const to = "0x000000000000000000000000000000000000dEaD" as const;
    const amount = BigInt(123);

    const mintTxHash = `0x${"aa".repeat(32)}` as const;
    const sentTxHash = `0x${"bb".repeat(32)}` as const;
    const recvTxHash = `0x${"cc".repeat(32)}` as const;

    const sepoliaClient = {
      getBlockNumber: vi.fn(async () => BigInt(100)),
      getLogs: vi.fn(async (params: { address: string }) => {
        if (
          params.address.toLowerCase() ===
          "0xcdda815db80ea21dad692b469f8d0e27e4853365".toLowerCase()
        ) {
          return [
            {
              args: { depositId, to, amount },
              transactionHash: mintTxHash,
              blockNumber: BigInt(99),
            },
          ];
        }
        if (
          params.address.toLowerCase() ===
          "0xc3ea3c53ed3504f4d527fccac5080249341ab185".toLowerCase()
        ) {
          return [
            {
              args: { messageId, depositId, to, amount },
              transactionHash: sentTxHash,
              blockNumber: BigInt(99),
            },
          ];
        }
        return [];
      }),
      readContract: vi.fn(async (params: { functionName: string }) => {
        if (params.functionName === "usedDepositId") return false;
        return null;
      }),
    };

    const baseClient = {
      getBlockNumber: vi.fn(async () => BigInt(200)),
      getLogs: vi.fn(async (params: { address: string }) => {
        if (
          params.address.toLowerCase() ===
          "0x66666ffd3b3595c6a45279e83cfda770285bf1a7".toLowerCase()
        ) {
          return [
            {
              args: { messageId, depositId, to, amount },
              transactionHash: recvTxHash,
              blockNumber: BigInt(199),
            },
          ];
        }
        return [];
      }),
      readContract: vi.fn(async (params: { functionName: string }) => {
        if (params.functionName === "getRouter") {
          return "0x0000000000000000000000000000000000000001";
        }
        return null;
      }),
    };

    vi.resetModules();

    const { createPublicClient } = await import("viem");
    const mockedCreatePublicClient = vi.mocked(createPublicClient);

    mockedCreatePublicClient.mockImplementation(
      (config: { chain?: { id: number } }) => {
        if (config.chain?.id === sepolia.id) return sepoliaClient as never;
        if (config.chain?.id === baseSepolia.id) return baseClient as never;
        throw new Error("Unexpected chain in createPublicClient mock");
      },
    );

    const { deriveDepositStatus } =
      await import("@/services/depositStatusClient");

    const result = await deriveDepositStatus({
      depositId,
      messageIdHint: messageId,
    });

    const stage = (id: string) => result.stages.find((s) => s.id === id);

    expect(stage("ReserveCheck")?.status).toBe("ok");
    expect(stage("PolicyCheck")?.status).toBe("ok");
    expect(stage("MintSepolia")?.status).toBe("ok");
    expect(stage("CCIPSend")?.status).toBe("ok");
    expect(stage("CCIPReceive")?.status).toBe("ok");
    expect(stage("DestinationMint")?.status).toBe("ok");

    expect(result.mintApproved?.to).toBe(to);
    expect(result.messageSent?.messageId).toBe(messageId);
    expect(result.messageReceived?.messageId).toBe(messageId);
  });

  it("marks MintSepolia ok when issuer says depositId already used", async () => {
    process.env.NEXT_PUBLIC_RESERVE_API_BASE_URL = "http://reserve.test";

    const depositId = `0x${"33".repeat(32)}` as const;

    const sepoliaClient = {
      getBlockNumber: vi.fn(async () => BigInt(100)),
      getLogs: vi.fn(async () => []),
      readContract: vi.fn(async (params: { functionName: string }) => {
        if (params.functionName === "usedDepositId") return true;
        return null;
      }),
    };

    const baseClient = {
      getBlockNumber: vi.fn(async () => BigInt(200)),
      getLogs: vi.fn(async () => []),
      readContract: vi.fn(async () => null),
    };

    vi.resetModules();

    const { createPublicClient } = await import("viem");
    const mockedCreatePublicClient = vi.mocked(createPublicClient);

    mockedCreatePublicClient.mockImplementation(
      (config: { chain?: { id: number } }) => {
        if (config.chain?.id === sepolia.id) return sepoliaClient as never;
        if (config.chain?.id === baseSepolia.id) return baseClient as never;
        throw new Error("Unexpected chain in createPublicClient mock");
      },
    );

    const { deriveDepositStatus } =
      await import("@/services/depositStatusClient");

    const result = await deriveDepositStatus({ depositId });

    const mintStage = result.stages.find((s) => s.id === "MintSepolia");
    expect(mintStage?.status).toBe("ok");
    expect(mintStage?.reason).toContain("DepositId already used");
  });
});
