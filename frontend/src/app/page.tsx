import { WalletConnectButton } from "@/components/WalletConnectButton";
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
          <div className="mb-6 flex items-center justify-between">
            <a
              href="/dashboard"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Go to dashboard
            </a>
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold">Phase 2 scaffold</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Reserve API:{" "}
                <span className="font-mono">
                  {env.NEXT_PUBLIC_RESERVE_API_BASE_URL}
                </span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Next steps: add shadcn/ui, core screens, and CCIP status
                tracking.
              </p>
            </CardHeader>
          </Card>

          <div className="mt-6">
            <ReserveStatusCard />
          </div>
        </Container>
      </main>
    </div>
  );
}
