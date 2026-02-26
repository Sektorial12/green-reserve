"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { useAccount } from "wagmi";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { InlineError } from "@/components/ui/InlineError";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { ChainIcon } from "@/components/ChainIcon";
import { env } from "@/lib/env";
import { bad, ok, pending } from "@/lib/status";
import {
  readErc20Balance,
  readIssuerPaused,
  readIssuerUsedDepositId,
} from "@/services/contractReadClient";

function isBytes32Hex(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function OnchainStatusCard() {
  const { address } = useAccount();
  const [addressInput, setAddressInput] = React.useState("");
  const [addressError, setAddressError] = React.useState<string | null>(null);
  const [depositIdInput, setDepositIdInput] = React.useState("");
  const [depositIdError, setDepositIdError] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (!address) return;
    setAddressInput((prev) => (prev ? prev : address));
  }, [address]);

  const trimmedAddress = addressInput.trim();
  const owner = isAddress(trimmedAddress) ? (trimmedAddress as Address) : null;

  const onchainQuery = useQuery({
    queryKey: ["onchain", "summary", owner],
    enabled: Boolean(owner),
    queryFn: async () => {
      if (!owner) throw new Error("Invalid address");

      const [tokenA, tokenB, paused] = await Promise.all([
        readErc20Balance({
          chain: "sepolia",
          tokenAddress: env.NEXT_PUBLIC_SEPOLIA_TOKEN_A_ADDRESS as Address,
          owner,
        }),
        readErc20Balance({
          chain: "baseSepolia",
          tokenAddress: env.NEXT_PUBLIC_BASE_SEPOLIA_TOKEN_B_ADDRESS as Address,
          owner,
        }),
        readIssuerPaused(),
      ]);

      return {
        tokenA,
        tokenB,
        paused,
      };
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const issuerStatus = onchainQuery.data
    ? onchainQuery.data.paused
      ? bad("Paused")
      : ok("Active")
    : pending("Unknown");

  const trimmedDepositId = depositIdInput.trim();
  const usedDepositIdQuery = useQuery({
    queryKey: ["onchain", "usedDepositId", trimmedDepositId],
    enabled: false,
    queryFn: async () => {
      if (!isBytes32Hex(trimmedDepositId)) {
        throw new Error("Invalid depositId");
      }

      return readIssuerUsedDepositId({ depositId: trimmedDepositId });
    },
    retry: 0,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">On-chain status</h2>
            <Badge variant={issuerStatus.variant}>{issuerStatus.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Token balances and issuer state (Sepolia / Base Sepolia)
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onchainQuery.refetch()}
          disabled={onchainQuery.isFetching || !owner}
        >
          {onchainQuery.isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </CardHeader>

      <CardContent>
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground">Address</div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={addressInput}
              onChange={(e) => {
                setAddressInput(e.target.value);
                setAddressError(null);
              }}
              placeholder={
                address ? "0x… (defaults to connected wallet)" : "0x…"
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
                await onchainQuery.refetch();
              }}
              disabled={onchainQuery.isFetching}
            >
              {onchainQuery.isFetching ? "Loading..." : "Load"}
            </Button>
          </div>

          {addressError ? (
            <div className="mt-2">
              <InlineError>{addressError}</InlineError>
            </div>
          ) : null}
        </div>

        {onchainQuery.isLoading ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-[74px]" />
            <Skeleton className="h-[74px]" />
            <Skeleton className="h-[74px]" />
            <Skeleton className="h-[74px]" />
          </div>
        ) : onchainQuery.error ? (
          <div className="mt-3">
            <InlineError>
              Failed to load on-chain data. Ensure your network/RPC is
              available.
            </InlineError>
            <div className="mt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onchainQuery.refetch()}
                disabled={onchainQuery.isFetching || !owner}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : onchainQuery.data ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <div className="text-xs text-muted-foreground">
                  TokenA (Sepolia)
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <ChainIcon chain="sepolia" className="mr-1" />
                  <div className="font-mono text-sm">
                    {onchainQuery.data.tokenA.formatted}
                  </div>
                  <div className="text-sm font-medium">
                    {onchainQuery.data.tokenA.info.symbol}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="text-xs text-muted-foreground">
                  TokenB (Base Sepolia)
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <ChainIcon chain="baseSepolia" className="mr-1" />
                  <div className="font-mono text-sm">
                    {onchainQuery.data.tokenB.formatted}
                  </div>
                  <div className="text-sm font-medium">
                    {onchainQuery.data.tokenB.info.symbol}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Enter an address to view balances.
          </p>
        )}

        <div className="mt-4 rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground">
            Deposit ID used check (issuer)
          </div>

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={depositIdInput}
              onChange={(e) => {
                setDepositIdInput(e.target.value);
                setDepositIdError(null);
              }}
              placeholder="0x… (bytes32 depositId)"
              className="font-mono"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const value = depositIdInput.trim();
                if (!isBytes32Hex(value)) {
                  setDepositIdError(
                    "depositId must be a 32-byte hex value (0x + 64 hex chars). ",
                  );
                  return;
                }

                await usedDepositIdQuery.refetch();
              }}
              disabled={usedDepositIdQuery.isFetching}
            >
              {usedDepositIdQuery.isFetching ? "Checking..." : "Check"}
            </Button>
          </div>

          {depositIdError ? (
            <div className="mt-2">
              <InlineError>{depositIdError}</InlineError>
            </div>
          ) : null}

          {usedDepositIdQuery.data !== undefined ? (
            <div className="mt-3 flex items-center gap-2">
              <Badge
                variant={
                  usedDepositIdQuery.data
                    ? bad("Used").variant
                    : ok("Unused").variant
                }
              >
                {usedDepositIdQuery.data
                  ? bad("Used").label
                  : ok("Unused").label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {usedDepositIdQuery.data
                  ? "Mint already executed for this depositId."
                  : "No mint recorded yet for this depositId."}
              </span>
            </div>
          ) : null}

          {usedDepositIdQuery.error ? (
            <div className="mt-2">
              <InlineError>Failed to check depositId.</InlineError>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
