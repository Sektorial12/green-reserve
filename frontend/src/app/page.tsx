import { WalletConnectButton } from "@/components/WalletConnectButton";
import { env } from "@/lib/env";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-6">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            GreenReserve
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Carbon-backed cross-chain stablecoin
          </h1>
        </div>
        <WalletConnectButton />
      </header>

      <main className="mx-auto w-full max-w-4xl px-6 pb-16">
        <section className="rounded-xl border bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-base font-semibold">Phase 2 scaffold</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Reserve API:{" "}
            <span className="font-mono">
              {env.NEXT_PUBLIC_RESERVE_API_BASE_URL}
            </span>
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Next steps: add shadcn/ui, core screens, and CCIP status tracking.
          </p>
        </section>
      </main>
    </div>
  );
}
