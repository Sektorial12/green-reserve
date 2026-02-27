"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";

import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider, Toaster } from "@/components/ui/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              const message =
                error instanceof Error ? error.message.toLowerCase() : "";
              if (message.includes("429") || message.includes("rate limit")) {
                return failureCount < 5;
              }
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(30_000, 1_000 * 2 ** attempt),
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {children}
          <Toaster />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
