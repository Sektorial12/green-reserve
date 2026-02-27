import Link from "next/link";

import { DepositStatusCard } from "@/components/DepositStatusCard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OnchainStatusCard } from "@/components/OnchainStatusCard";
import { RecentDepositsCard } from "@/components/RecentDepositsCard";
import { ReserveStatusCard } from "@/components/ReserveStatusCard";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Container } from "@/components/ui/Container";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="py-6">
        <Container className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Basic scaffold for balances, activity, and status.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Link
                href="/mint"
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Mint / Deposit
              </Link>
              <Link
                href="/admin"
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Admin
              </Link>
            </div>
          </div>

          <WalletConnectButton />
        </Container>
      </header>

      <main className="pb-16">
        <Container>
          <div className="space-y-6">
            <ErrorBoundary title="Reserve widget failed">
              <ReserveStatusCard />
            </ErrorBoundary>
            <ErrorBoundary title="On-chain status widget failed">
              <OnchainStatusCard />
            </ErrorBoundary>
            <RecentDepositsCard />
            <ErrorBoundary title="Deposit status widget failed">
              <DepositStatusCard />
            </ErrorBoundary>
          </div>
        </Container>
      </main>
    </div>
  );
}
