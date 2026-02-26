"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { isAddress } from "viem";
import * as React from "react";
import { useAccount } from "wagmi";

import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { InlineError } from "@/components/ui/InlineError";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { env } from "@/lib/env";
import { bad, ok, pending } from "@/lib/status";
import { readIssuerPaused } from "@/services/contractReadClient";
import { reserveApi } from "@/services/reserveApiClient";

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const [addressInput, setAddressInput] = React.useState("");
  const [addressError, setAddressError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!address) return;
    setAddressInput((prev) => (prev ? prev : address));
  }, [address]);

  const reserveQuery = useQuery({
    queryKey: ["admin", "reserveRaw"],
    queryFn: () => reserveApi.reserves(),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const pausedQuery = useQuery({
    queryKey: ["admin", "issuerPaused"],
    queryFn: () => readIssuerPaused(),
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const issuerStatus = pausedQuery.data
    ? pausedQuery.data
      ? bad("Paused")
      : ok("Active")
    : pending("Unknown");

  const trimmedAddress = addressInput.trim();
  const allowlistQuery = useQuery({
    queryKey: ["admin", "policyKyc", trimmedAddress],
    enabled: false,
    queryFn: async () => {
      if (!isAddress(trimmedAddress)) throw new Error("Invalid address");
      return reserveApi.policyKyc(trimmedAddress);
    },
    retry: 0,
    refetchOnWindowFocus: false,
  });

  const allowlistStatus = allowlistQuery.data
    ? allowlistQuery.data.isAllowed
      ? ok("Allowed")
      : bad("Blocked")
    : pending("Unknown");

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="py-6">
        <Container className="flex items-start justify-between gap-6">
          <div>
            <a
              href="/dashboard"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Back to dashboard
            </a>
            <h1 className="mt-2 text-xl font-semibold tracking-tight">Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only compliance and operational status.
            </p>
          </div>
          <WalletConnectButton />
        </Container>
      </header>

      <main className="pb-16">
        <Container>
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">
                      Issuer pause state
                    </h2>
                    <Badge variant={issuerStatus.variant}>
                      {issuerStatus.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sepolia issuer contract.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => pausedQuery.refetch()}
                  disabled={pausedQuery.isFetching}
                >
                  {pausedQuery.isFetching ? "Refreshing..." : "Refresh"}
                </Button>
              </CardHeader>
              <CardContent>
                {pausedQuery.isLoading ? (
                  <Skeleton className="h-[74px]" />
                ) : pausedQuery.error ? (
                  <InlineError>Failed to read issuer pause state.</InlineError>
                ) : (
                  <div className="rounded-lg border border-border p-4">
                    <div className="text-xs text-muted-foreground">
                      Issuer address
                    </div>
                    <div className="mt-1 font-mono text-sm">
                      {env.NEXT_PUBLIC_SEPOLIA_ISSUER_ADDRESS as Address}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">Reserve API raw</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Debug view of the most recent reserve-api response.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reserveQuery.refetch()}
                  disabled={reserveQuery.isFetching}
                >
                  {reserveQuery.isFetching ? "Refreshing..." : "Refresh"}
                </Button>
              </CardHeader>
              <CardContent>
                {reserveQuery.isLoading ? (
                  <Skeleton className="h-[140px]" />
                ) : reserveQuery.error ? (
                  <InlineError>Failed to load reserve API data.</InlineError>
                ) : (
                  <pre className="overflow-auto rounded-lg border border-border bg-background p-4 text-xs">
                    {JSON.stringify(reserveQuery.data, null, 2)}
                  </pre>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold">Allowlist</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Checks policy allow/block decision via reserve-api.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        value={addressInput}
                        onChange={(e) => {
                          setAddressInput(e.target.value);
                          setAddressError(null);
                        }}
                        placeholder={
                          isConnected
                            ? "0x… (defaults to connected wallet)"
                            : "0x…"
                        }
                        className="font-mono"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          if (!isAddress(trimmedAddress)) {
                            setAddressError("Enter a valid 0x address.");
                            return;
                          }

                          setAddressError(null);
                          await allowlistQuery.refetch();
                        }}
                        disabled={allowlistQuery.isFetching}
                      >
                        {allowlistQuery.isFetching ? "Checking..." : "Check"}
                      </Button>
                    </div>

                    {addressError ? (
                      <div className="mt-2">
                        <InlineError>{addressError}</InlineError>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-muted-foreground">
                        Policy decision
                      </div>
                      <Badge variant={allowlistStatus.variant}>
                        {allowlistStatus.label}
                      </Badge>
                    </div>

                    {allowlistQuery.isLoading ? (
                      <div className="mt-3">
                        <Skeleton className="h-[52px]" />
                      </div>
                    ) : allowlistQuery.error ? (
                      <div className="mt-2">
                        <InlineError>
                          Failed to load policy decision.
                        </InlineError>
                      </div>
                    ) : allowlistQuery.data ? (
                      <div className="mt-2 text-sm text-muted-foreground">
                        {allowlistQuery.data.reason}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-muted-foreground">
                        Enter an address and click Check.
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </Container>
      </main>
    </div>
  );
}
