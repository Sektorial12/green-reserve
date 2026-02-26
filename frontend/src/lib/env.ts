import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const schema = z.object({
  NEXT_PUBLIC_RESERVE_API_BASE_URL: z
    .string()
    .url()
    .default("http://localhost:8788"),
  NEXT_PUBLIC_APP_NAME: z.string().default("GreenReserve"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
  NEXT_PUBLIC_SEPOLIA_RPC_URL: z.string().url().optional(),
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: z.string().url().optional(),
  NEXT_PUBLIC_SEPOLIA_BLOCK_EXPLORER_BASE_URL: z
    .string()
    .url()
    .default("https://sepolia.etherscan.io"),
  NEXT_PUBLIC_BASE_SEPOLIA_BLOCK_EXPLORER_BASE_URL: z
    .string()
    .url()
    .default("https://sepolia.basescan.org"),
  NEXT_PUBLIC_SEPOLIA_TOKEN_A_ADDRESS: addressSchema.default(
    "0x6bf0a9cfdf9167af8d30e53475752db0dc802b80",
  ),
  NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS: addressSchema.default(
    "0xcdda815db80ea21dad692b469f8d0e27e4853365",
  ),
  NEXT_PUBLIC_BASE_SEPOLIA_TOKEN_B_ADDRESS: addressSchema.default(
    "0x20F061Db666A0BC3Fa631C52f8a65DdA287264A1",
  ),
});

export const env = schema.parse({
  NEXT_PUBLIC_RESERVE_API_BASE_URL:
    process.env.NEXT_PUBLIC_RESERVE_API_BASE_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  NEXT_PUBLIC_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL:
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_SEPOLIA_BLOCK_EXPLORER_BASE_URL:
    process.env.NEXT_PUBLIC_SEPOLIA_BLOCK_EXPLORER_BASE_URL,
  NEXT_PUBLIC_BASE_SEPOLIA_BLOCK_EXPLORER_BASE_URL:
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_BLOCK_EXPLORER_BASE_URL,
  NEXT_PUBLIC_SEPOLIA_TOKEN_A_ADDRESS:
    process.env.NEXT_PUBLIC_SEPOLIA_TOKEN_A_ADDRESS,
  NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS:
    process.env.NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS,
  NEXT_PUBLIC_BASE_SEPOLIA_TOKEN_B_ADDRESS:
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_TOKEN_B_ADDRESS,
});
