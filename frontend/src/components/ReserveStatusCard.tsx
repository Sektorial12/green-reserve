"use client";

import { useQuery } from "@tanstack/react-query";

import { reserveApi } from "@/services/reserveApiClient";

function ratioLabelFromBps(bps: string) {
  const n = Number.parseInt(bps, 10);
  if (!Number.isFinite(n)) return "—";
  return `${(n / 100).toFixed(2)}%`;
}

export function ReserveStatusCard() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["reserveState"],
    queryFn: () => reserveApi.reserves(),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <section className="rounded-xl border bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Reserves</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Live data from reserve-api
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
          onClick={() => refetch()}
          disabled={isLoading || isFetching}
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">
            Failed to load reserves. Make sure reserve-api is running.
          </p>
        ) : data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Reserve ratio</div>
              <div className="mt-1 text-lg font-semibold">
                {ratioLabelFromBps(data.reserveRatioBps)}
              </div>
            </div>
            <div className="rounded-lg border p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Scenario</div>
              <div className="mt-1 text-lg font-semibold">{data.scenario}</div>
            </div>
            <div className="rounded-lg border p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Reserves (USD)</div>
              <div className="mt-1 font-mono text-sm">
                {data.totalReservesUsd}
              </div>
            </div>
            <div className="rounded-lg border p-4 dark:border-zinc-800">
              <div className="text-xs text-zinc-500">Liabilities (USD)</div>
              <div className="mt-1 font-mono text-sm">
                {data.totalLiabilitiesUsd}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No data.</p>
        )}
      </div>
    </section>
  );
}
