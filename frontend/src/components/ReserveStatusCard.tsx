"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { InlineError } from "@/components/ui/InlineError";
import { Skeleton } from "@/components/ui/Skeleton";
import { bad, ok } from "@/lib/status";
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

  const ratioBps = data?.reserveRatioBps;
  const ratioNum = ratioBps ? Number.parseInt(ratioBps, 10) : null;
  const ratioOk =
    ratioNum !== null && Number.isFinite(ratioNum) && ratioNum >= 10_000;

  const ratioStatus =
    ratioNum !== null && Number.isFinite(ratioNum)
      ? ratioOk
        ? ok("Healthy")
        : bad("Unhealthy")
      : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Reserves</h2>
            {ratioStatus ? (
              <Badge variant={ratioStatus.variant}>{ratioStatus.label}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live data from reserve-api
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading || isFetching}
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-[74px]" />
            <Skeleton className="h-[74px]" />
            <Skeleton className="h-[74px]" />
            <Skeleton className="h-[74px]" />
          </div>
        ) : error ? (
          <InlineError>
            Failed to load reserves. Make sure reserve-api is running.
          </InlineError>
        ) : data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">Reserve ratio</div>
              <div className="mt-1 text-lg font-semibold">
                {ratioLabelFromBps(data.reserveRatioBps)}
              </div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">Scenario</div>
              <div className="mt-1 text-lg font-semibold">{data.scenario}</div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">
                Reserves (USD)
              </div>
              <div className="mt-1 font-mono text-sm">
                {data.totalReservesUsd}
              </div>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-xs text-muted-foreground">
                Liabilities (USD)
              </div>
              <div className="mt-1 font-mono text-sm">
                {data.totalLiabilitiesUsd}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No data.</p>
        )}
      </CardContent>
    </Card>
  );
}
