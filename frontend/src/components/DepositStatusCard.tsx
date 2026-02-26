"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import type { Hex } from "viem";

import { ChainIcon } from "@/components/ChainIcon";
import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { InlineError } from "@/components/ui/InlineError";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { env } from "@/lib/env";
import { addRecentDepositId } from "@/lib/depositHistory";
import { ok, pending } from "@/lib/status";
import {
  deriveDepositStatus,
  type DepositStage,
  type DerivedDepositStatus,
} from "@/services/depositStatusClient";

function isBytes32Hex(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function stageLabel(stage: DepositStage["id"]) {
  switch (stage) {
    case "DepositReceived":
      return "Deposit received";
    case "ReserveCheckPassed":
      return "Reserve check passed";
    case "PolicyCheckPassed":
      return "Policy check passed";
    case "MintSepoliaConfirmed":
      return "Mint approved (Sepolia)";
    case "CCIPSendConfirmed":
      return "CCIP message sent (Sepolia)";
    case "CCIPReceiveObserved":
      return "Message received (Base Sepolia)";
    default:
      return stage;
  }
}

function txUrl(chain: "sepolia" | "baseSepolia", txHash: string) {
  const base =
    chain === "sepolia"
      ? env.NEXT_PUBLIC_SEPOLIA_BLOCK_EXPLORER_BASE_URL
      : env.NEXT_PUBLIC_BASE_SEPOLIA_BLOCK_EXPLORER_BASE_URL;
  return `${base}/tx/${txHash}`;
}

function DepositStageRow({ stage }: { stage: DepositStage }) {
  const stageStatus = stage.present ? ok("Done") : pending("Pending");

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
      <div className="flex min-w-0 items-center gap-3">
        {stage.chain ? <ChainIcon chain={stage.chain} /> : null}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {stageLabel(stage.id)}
          </div>
          {stage.blockNumber ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Block {stage.blockNumber.toString()}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant={stageStatus.variant}>{stageStatus.label}</Badge>

        {stage.txHash && stage.chain ? (
          <a
            href={txUrl(stage.chain, stage.txHash)}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            View
          </a>
        ) : null}
      </div>
    </div>
  );
}

function StatusSummary({ status }: { status: DerivedDepositStatus }) {
  const sent = status.messageSent;
  const received = status.messageReceived;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-4">
        <div className="text-xs text-muted-foreground">depositId</div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="truncate font-mono text-sm">{status.depositId}</div>
          <CopyButton value={status.depositId} variant="secondary" size="sm">
            Copy
          </CopyButton>
        </div>
      </div>

      {sent?.messageId ? (
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground">messageId</div>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="truncate font-mono text-sm">{sent.messageId}</div>
            <CopyButton value={sent.messageId} variant="secondary" size="sm">
              Copy
            </CopyButton>
          </div>
        </div>
      ) : null}

      {received?.messageId ? (
        <p className="text-sm text-muted-foreground">
          Destination mint should be confirmed if TokenB balance increased.
        </p>
      ) : null}
    </div>
  );
}

export type DepositStatusCardProps = {
  initialDepositId?: string;
  autoCheck?: boolean;
  autoRefresh?: boolean;
  readOnly?: boolean;
};

export function DepositStatusCard({
  initialDepositId,
  autoCheck,
  autoRefresh,
  readOnly,
}: DepositStatusCardProps) {
  const [depositIdInput, setDepositIdInput] = React.useState(
    initialDepositId ?? "",
  );
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(
    Boolean(autoRefresh),
  );
  const [pollAttempt, setPollAttempt] = React.useState(0);
  const [cooldownActive, setCooldownActive] = React.useState(false);
  const cooldownTimerRef = React.useRef<number | null>(null);

  const trimmed = depositIdInput.trim();

  const query = useQuery({
    queryKey: ["depositStatus", trimmed],
    enabled: false,
    queryFn: async () => {
      if (!isBytes32Hex(trimmed)) throw new Error("Invalid depositId");
      return deriveDepositStatus({ depositId: trimmed });
    },
    retry: 0,
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    if (!autoCheck) return;
    if (!isBytes32Hex(trimmed)) return;
    void query.refetch();
  }, [autoCheck, trimmed, query]);

  const terminalStage = query.data?.stages.find(
    (s) => s.id === "CCIPReceiveObserved",
  );
  const isTerminal = Boolean(terminalStage?.present);

  React.useEffect(() => {
    if (!autoRefreshEnabled) return;
    if (!isBytes32Hex(trimmed)) return;
    if (isTerminal) return;
    if (query.isFetching) return;

    if (!query.data) {
      void query.refetch();
      return;
    }

    const delayMs = Math.min(60_000, 2_000 * 2 ** pollAttempt);
    const timer = window.setTimeout(() => {
      setPollAttempt((n) => n + 1);
      void query.refetch();
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoRefreshEnabled, trimmed, isTerminal, pollAttempt, query]);

  const manualRefreshCooldownMs = 3_000;
  const refreshDisabled = query.isFetching || cooldownActive;

  React.useEffect(() => {
    return () => {
      if (cooldownTimerRef.current !== null) {
        window.clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Deposit status</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Derives status from on-chain events (MintApproved / MessageSent /
            MessageReceived).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAutoRefreshEnabled((v) => !v);
              setPollAttempt(0);
            }}
            disabled={isTerminal}
          >
            Auto: {autoRefreshEnabled ? "On" : "Off"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const value = depositIdInput.trim();
              if (!isBytes32Hex(value)) {
                setInputError(
                  "depositId must be a 32-byte hex value (0x + 64 hex chars).",
                );
                return;
              }

              setInputError(null);
              addRecentDepositId(value);
              setPollAttempt(0);

              if (cooldownTimerRef.current !== null) {
                window.clearTimeout(cooldownTimerRef.current);
              }
              setCooldownActive(true);
              cooldownTimerRef.current = window.setTimeout(() => {
                setCooldownActive(false);
              }, manualRefreshCooldownMs);

              await query.refetch();
            }}
            disabled={refreshDisabled}
          >
            {query.isFetching
              ? "Checking..."
              : cooldownActive
                ? "Wait..."
                : "Refresh"}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={depositIdInput}
            onChange={(e) => {
              if (readOnly) return;
              setDepositIdInput(e.target.value);
              setInputError(null);
            }}
            placeholder="0x… (bytes32 depositId)"
            className="font-mono"
            disabled={readOnly}
          />
        </div>

        {inputError ? (
          <div className="mt-3">
            <InlineError>{inputError}</InlineError>
          </div>
        ) : null}

        {query.isLoading ? (
          <div className="mt-4 grid grid-cols-1 gap-3">
            <Skeleton className="h-[52px]" />
            <Skeleton className="h-[52px]" />
            <Skeleton className="h-[52px]" />
          </div>
        ) : query.error ? (
          <div className="mt-3">
            <InlineError>Failed to derive deposit status.</InlineError>
          </div>
        ) : query.data ? (
          <div className="mt-4">
            <Tabs defaultValue="timeline">
              <TabsList>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="summary">Summary</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline" className="mt-3 space-y-2">
                {query.data.stages.map((stage) => (
                  <DepositStageRow key={stage.id} stage={stage} />
                ))}
              </TabsContent>

              <TabsContent value="summary" className="mt-3">
                <StatusSummary status={query.data} />
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Enter a depositId to begin.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
