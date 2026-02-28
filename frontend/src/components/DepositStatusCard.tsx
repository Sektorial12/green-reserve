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
import { isE2eTest } from "@/lib/e2e";
import { env } from "@/lib/env";
import { addRecentDepositId } from "@/lib/depositHistory";
import { bad, ok, pending } from "@/lib/status";
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
    case "ReserveCheck":
      return "Reserve check";
    case "PolicyCheck":
      return "Policy check";
    case "MintSepolia":
      return "Mint approved (Sepolia)";
    case "CCIPSend":
      return "CCIP message sent (Sepolia)";
    case "CCIPReceive":
      return "Router executed (Base Sepolia)";
    case "DestinationMint":
      return "Message received + minted (Base Sepolia)";
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

function ccipMessageUrl(messageId: string) {
  let base = env.NEXT_PUBLIC_CCIP_EXPLORER_BASE_URL;
  base = base.replace(/\/$/, "");
  base = base.replace(/#$/, "");
  base = base.replace(/\/$/, "");
  return `${base}/msg/${messageId}`;
}

function DepositStageRow({ stage }: { stage: DepositStage }) {
  const isCheckStage =
    stage.id === "ReserveCheck" || stage.id === "PolicyCheck";
  const stageStatus =
    stage.status === "ok"
      ? isCheckStage
        ? ok("Passed")
        : ok("Done")
      : stage.status === "bad"
        ? bad(isCheckStage ? "Failed" : "Failed")
        : stage.status === "pending"
          ? pending("Pending")
          : pending("Unknown");

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

          {stage.confirmations !== undefined ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {stage.confirmations.toString()} confirmations
            </div>
          ) : null}

          {stage.reason ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {stage.reason}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant={stageStatus.variant}>{stageStatus.label}</Badge>

        {stage.messageId ? (
          <CopyButton value={stage.messageId} variant="secondary" size="sm">
            Copy msg
          </CopyButton>
        ) : null}

        {stage.messageId ? (
          <a
            href={ccipMessageUrl(stage.messageId)}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            CCIP
          </a>
        ) : null}

        {stage.txHash ? (
          <CopyButton value={stage.txHash} variant="secondary" size="sm">
            Copy tx
          </CopyButton>
        ) : null}

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
  const sendStage = status.stages.find((s) => s.id === "CCIPSend");
  const receiveStage = status.stages.find((s) => s.id === "CCIPReceive");
  const messageId =
    sent?.messageId ??
    received?.messageId ??
    sendStage?.messageId ??
    receiveStage?.messageId;
  const reserveStage = status.stages.find((s) => s.id === "ReserveCheck");
  const policyStage = status.stages.find((s) => s.id === "PolicyCheck");

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

      {messageId ? (
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground">messageId</div>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="truncate font-mono text-sm">{messageId}</div>
            <div className="flex items-center gap-2">
              <CopyButton value={messageId} variant="secondary" size="sm">
                Copy
              </CopyButton>
              <a
                href={ccipMessageUrl(messageId)}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                CCIP Explorer
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground">CCIP explorer</div>
          <div className="mt-1">
            <a
              href={env.NEXT_PUBLIC_CCIP_EXPLORER_BASE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Open CCIP Explorer
            </a>
          </div>
        </div>
      )}

      {received?.messageId ? (
        <p className="text-sm text-muted-foreground">
          Destination mint should be confirmed if TokenB balance increased.
        </p>
      ) : null}

      {reserveStage?.reason ? (
        <p className="text-sm text-muted-foreground">{reserveStage.reason}</p>
      ) : null}

      {policyStage?.reason ? (
        <p className="text-sm text-muted-foreground">{policyStage.reason}</p>
      ) : null}
    </div>
  );
}

export type DepositStatusCardProps = {
  initialDepositId?: string;
  initialMessageIdHint?: string;
  autoCheck?: boolean;
  autoRefresh?: boolean;
  readOnly?: boolean;
};

export function DepositStatusCard({
  initialDepositId,
  initialMessageIdHint,
  autoCheck,
  autoRefresh,
  readOnly,
}: DepositStatusCardProps) {
  const [depositIdInput, setDepositIdInput] = React.useState(
    initialDepositId ?? "",
  );
  const [messageIdHintInput, setMessageIdHintInput] = React.useState(
    initialMessageIdHint ?? "",
  );
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [messageIdError, setMessageIdError] = React.useState<string | null>(
    null,
  );
  const [autoRefreshEnabled, setAutoRefreshEnabled] = React.useState(
    Boolean(autoRefresh),
  );
  const [pollAttempt, setPollAttempt] = React.useState(0);
  const [pollStartedAt, setPollStartedAt] = React.useState<number | null>(null);
  const [cooldownActive, setCooldownActive] = React.useState(false);
  const cooldownTimerRef = React.useRef<number | null>(null);

  const trimmed = depositIdInput.trim();
  const trimmedMessageIdHint = messageIdHintInput.trim();
  const messageIdHint = isBytes32Hex(trimmedMessageIdHint)
    ? trimmedMessageIdHint
    : undefined;

  const query = useQuery({
    queryKey: ["depositStatus", trimmed, trimmedMessageIdHint],
    enabled: false,
    queryFn: async () => {
      if (!isBytes32Hex(trimmed)) throw new Error("Invalid depositId");
      if (isE2eTest()) {
        const url = new URL("/e2e/deposit-status", window.location.origin);
        url.searchParams.set("depositId", trimmed);
        if (messageIdHint) url.searchParams.set("messageIdHint", messageIdHint);

        const res = await fetch(url.toString(), { method: "GET" });
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        return (await res.json()) as DerivedDepositStatus;
      }

      return deriveDepositStatus({ depositId: trimmed, messageIdHint });
    },
    retry: 1,
    retryDelay: (attempt) => Math.min(5_000, 1_000 * attempt),
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    if (!autoCheck) return;
    if (!isBytes32Hex(trimmed)) return;
    void query.refetch();
  }, [autoCheck, trimmed, trimmedMessageIdHint, query]);

  const terminalStage = query.data?.stages.find(
    (s) => s.id === "DestinationMint",
  );
  const isTerminal = terminalStage?.status === "ok";

  React.useEffect(() => {
    if (!autoRefreshEnabled) return;
    if (!isBytes32Hex(trimmed)) return;
    if (isTerminal) return;
    if (query.isFetching) return;

    if (pollStartedAt === null) {
      setPollStartedAt(Date.now());
    }

    if (!query.data) {
      void query.refetch();
      return;
    }

    const maxAttempts = 12;
    const maxDurationMs = 10 * 60_000;
    if (pollAttempt >= maxAttempts) return;
    if (pollStartedAt !== null && Date.now() - pollStartedAt >= maxDurationMs) {
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
  }, [
    autoRefreshEnabled,
    trimmed,
    isTerminal,
    pollAttempt,
    pollStartedAt,
    query,
  ]);

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
          <p className="mt-1 text-sm text-muted-foreground">
            CCIP delivery is async and may take a few minutes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAutoRefreshEnabled((v) => !v);
              setPollAttempt(0);
              setPollStartedAt(null);
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

              const msgValue = messageIdHintInput.trim();
              if (msgValue && !isBytes32Hex(msgValue)) {
                setMessageIdError(
                  "messageId must be a 32-byte hex value (0x + 64 hex chars).",
                );
                return;
              }

              setInputError(null);
              setMessageIdError(null);
              addRecentDepositId(value);
              setPollAttempt(0);
              setPollStartedAt(null);

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

        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={messageIdHintInput}
            onChange={(e) => {
              setMessageIdHintInput(e.target.value);
              setMessageIdError(null);
            }}
            placeholder="0x… (optional messageId hint)"
            className="font-mono"
            disabled={readOnly}
          />
        </div>

        {inputError ? (
          <div className="mt-3">
            <InlineError>{inputError}</InlineError>
          </div>
        ) : null}

        {messageIdError ? (
          <div className="mt-3">
            <InlineError>{messageIdError}</InlineError>
          </div>
        ) : null}

        {query.isLoading ? (
          <div className="mt-4 grid grid-cols-1 gap-3">
            <Skeleton className="h-[52px]" />
            <Skeleton className="h-[52px]" />
            <Skeleton className="h-[52px]" />
          </div>
        ) : query.error ? (
          <div className="mt-3 space-y-2">
            <InlineError>Failed to derive deposit status.</InlineError>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              Retry
            </Button>
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
