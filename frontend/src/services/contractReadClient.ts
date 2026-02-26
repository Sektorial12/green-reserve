import {
  createPublicClient,
  formatUnits,
  http,
  parseAbi,
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

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const ISSUER_ABI = parseAbi([
  "function paused() view returns (bool)",
  "function usedDepositId(bytes32 depositId) view returns (bool)",
]);

type ChainKey = "sepolia" | "baseSepolia";

type TokenInfo = {
  symbol: string;
  decimals: number;
};

const tokenInfoCache = new Map<string, TokenInfo>();

function getClient(chain: ChainKey) {
  return chain === "sepolia" ? sepoliaClient : baseSepoliaClient;
}

function tokenInfoCacheKey(chain: ChainKey, tokenAddress: Address) {
  return `${chain}:${tokenAddress.toLowerCase()}`;
}

export async function readErc20TokenInfo(params: {
  chain: ChainKey;
  tokenAddress: Address;
}): Promise<TokenInfo> {
  const key = tokenInfoCacheKey(params.chain, params.tokenAddress);
  const cached = tokenInfoCache.get(key);
  if (cached) return cached;

  const client = getClient(params.chain);

  const [symbol, decimals] = await Promise.all([
    client.readContract({
      address: params.tokenAddress,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
    client.readContract({
      address: params.tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
  ]);

  const info = {
    symbol,
    decimals: Number(decimals),
  };

  tokenInfoCache.set(key, info);
  return info;
}

export async function readErc20Balance(params: {
  chain: ChainKey;
  tokenAddress: Address;
  owner: Address;
}): Promise<{ balance: bigint; formatted: string; info: TokenInfo }> {
  const client = getClient(params.chain);

  const [info, balance] = await Promise.all([
    readErc20TokenInfo({
      chain: params.chain,
      tokenAddress: params.tokenAddress,
    }),
    client.readContract({
      address: params.tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [params.owner],
    }),
  ]);

  return {
    balance,
    formatted: formatUnits(balance, info.decimals),
    info,
  };
}

export async function readIssuerPaused(): Promise<boolean> {
  return sepoliaClient.readContract({
    address: env.NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS as Address,
    abi: ISSUER_ABI,
    functionName: "paused",
  });
}

export async function readIssuerUsedDepositId(params: {
  depositId: Hex;
}): Promise<boolean> {
  return sepoliaClient.readContract({
    address: env.NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS as Address,
    abi: ISSUER_ABI,
    functionName: "usedDepositId",
    args: [params.depositId],
  });
}
