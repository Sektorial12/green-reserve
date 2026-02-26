import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_RESERVE_API_BASE_URL: z
    .string()
    .url()
    .default("http://localhost:8788"),
  NEXT_PUBLIC_APP_NAME: z.string().default("GreenReserve"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
});

export const env = schema.parse({
  NEXT_PUBLIC_RESERVE_API_BASE_URL:
    process.env.NEXT_PUBLIC_RESERVE_API_BASE_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});
