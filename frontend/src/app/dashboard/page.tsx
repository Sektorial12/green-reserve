import { ReserveStatusCard } from "@/components/ReserveStatusCard";
import { Container } from "@/components/ui/Container";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="py-6">
        <Container>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Basic scaffold for balances, activity, and status.
          </p>
        </Container>
      </header>

      <main className="pb-16">
        <Container>
          <ReserveStatusCard />
        </Container>
      </main>
    </div>
  );
}
