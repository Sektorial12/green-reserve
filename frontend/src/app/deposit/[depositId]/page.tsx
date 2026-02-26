"use client";

import type { Hex } from "viem";

import { DepositStatusCard } from "@/components/DepositStatusCard";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Container } from "@/components/ui/Container";
import { InlineError } from "@/components/ui/InlineError";

function isBytes32Hex(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

export default function DepositDetailPage({
  params,
}: {
  params: { depositId: string };
}) {
  const depositId = decodeURIComponent(params.depositId);

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="py-6">
        <Container className="flex items-center justify-between">
          <div>
            <a
              href="/dashboard"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Back to dashboard
            </a>
            <h1 className="mt-2 text-xl font-semibold tracking-tight">
              Deposit detail
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Track a depositId across Sepolia and Base Sepolia.
            </p>
          </div>
          <WalletConnectButton />
        </Container>
      </header>

      <main className="pb-16">
        <Container>
          {!isBytes32Hex(depositId) ? (
            <InlineError>Invalid depositId in URL.</InlineError>
          ) : (
            <DepositStatusCard
              initialDepositId={depositId}
              autoCheck
              autoRefresh
              readOnly
            />
          )}
        </Container>
      </main>
    </div>
  );
}
