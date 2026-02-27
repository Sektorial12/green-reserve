import { WalletConnectButton } from "@/components/WalletConnectButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReserveStatusCard } from "@/components/ReserveStatusCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { env } from "@/lib/env";

export default function Home() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="py-6">
        <Container className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-muted-foreground">
              GreenReserve
            </span>
            <h1 className="text-xl font-semibold tracking-tight">
              Carbon-backed cross-chain stablecoin
            </h1>
          </div>
          <WalletConnectButton />
        </Container>
      </header>

      <main className="pb-16">
        <Container>
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold">Testnet demo</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                GreenReserve is a demo stablecoin flow across Sepolia and Base
                Sepolia.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                This UI is for testnets only. Do not use real funds.
              </p>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <a
                  href="/mint"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
                >
                  Mint / Deposit
                </a>
                <a
                  href="/dashboard"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Dashboard
                </a>
              </div>

              <p className="mt-4 text-sm text-muted-foreground">
                Reserve API:{" "}
                <span className="font-mono">
                  {env.NEXT_PUBLIC_RESERVE_API_BASE_URL}
                </span>
              </p>
            </CardHeader>
          </Card>

          <div className="mt-6">
            <ErrorBoundary title="Reserve widget failed">
              <ReserveStatusCard />
            </ErrorBoundary>
          </div>
        </Container>
      </main>
    </div>
  );
}
