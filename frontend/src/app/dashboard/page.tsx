import { ReserveStatusCard } from "@/components/ReserveStatusCard";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <header className="mx-auto w-full max-w-4xl px-6 py-6">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Basic scaffold for balances, activity, and status.
        </p>
      </header>

      <main className="mx-auto w-full max-w-4xl px-6 pb-16">
        <ReserveStatusCard />
      </main>
    </div>
  );
}
