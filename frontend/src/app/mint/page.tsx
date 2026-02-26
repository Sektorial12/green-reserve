"use client";

import * as React from "react";
import type { Hex } from "viem";
import { isAddress } from "viem";
import { useAccount } from "wagmi";

import { CopyButton } from "@/components/CopyButton";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { InlineError } from "@/components/ui/InlineError";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { addRecentDepositId } from "@/lib/depositHistory";
import { ok, pending } from "@/lib/status";

function isBytes32Hex(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function bytes32FromRandom(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

export default function MintPage() {
  const { isConnected, address } = useAccount();
  const { toast } = useToast();

  const [toInput, setToInput] = React.useState("");
  const [amountInput, setAmountInput] = React.useState("");
  const [depositIdInput, setDepositIdInput] = React.useState("");

  const [error, setError] = React.useState<string | null>(null);

  const toTrimmed = toInput.trim();
  const depositIdTrimmed = depositIdInput.trim();

  const toValid = !toTrimmed ? null : (isAddress(toTrimmed) as boolean);
  const depositIdValid = !depositIdTrimmed
    ? null
    : isBytes32Hex(depositIdTrimmed);

  const parsedAmount = Number(amountInput);
  const amountValid = !amountInput
    ? null
    : Number.isFinite(parsedAmount) && parsedAmount > 0;

  const canPreview = Boolean(toValid && amountValid);

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="py-6">
        <Container className="flex items-center justify-between">
          <div>
            <a
              href="/dashboard"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Back to dashboard
            </a>
            <h1 className="mt-2 text-xl font-semibold tracking-tight">
              Mint / Deposit
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Demo flow on testnets (Sepolia → Base Sepolia).
            </p>
          </div>
          <WalletConnectButton />
        </Container>
      </header>

      <main className="pb-16">
        <Container>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">Deposit intent</h2>
                  <Badge variant={pending("Draft").variant}>
                    {pending("Draft").label}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Collect the information needed to mint on Sepolia and send via
                  CCIP.
                </p>
              </CardHeader>

              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Destination address (Base Sepolia)
                    </div>
                    <Input
                      value={toInput}
                      onChange={(e) => {
                        setToInput(e.target.value);
                        setError(null);
                      }}
                      placeholder="0x…"
                      className="font-mono"
                    />
                    {toValid === false ? (
                      <div className="mt-2">
                        <InlineError>Invalid address.</InlineError>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">Amount</div>
                    <Input
                      value={amountInput}
                      onChange={(e) => {
                        setAmountInput(e.target.value);
                        setError(null);
                      }}
                      placeholder="100"
                      inputMode="decimal"
                    />
                    {amountValid === false ? (
                      <div className="mt-2">
                        <InlineError>Enter a positive number.</InlineError>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        depositId (optional)
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          if (typeof crypto === "undefined") return;
                          setDepositIdInput(bytes32FromRandom());
                          setError(null);
                        }}
                      >
                        Generate
                      </Button>
                    </div>
                    <Input
                      value={depositIdInput}
                      onChange={(e) => {
                        setDepositIdInput(e.target.value);
                        setError(null);
                      }}
                      placeholder="0x… (bytes32)"
                      className="font-mono"
                    />
                    {depositIdValid === false ? (
                      <div className="mt-2">
                        <InlineError>
                          depositId must be a 32-byte hex value (0x + 64 hex
                          chars).
                        </InlineError>
                      </div>
                    ) : null}
                  </div>

                  {error ? <InlineError>{error}</InlineError> : null}

                  <Button
                    variant="primary"
                    onClick={() => {
                      if (!isConnected || !address) {
                        setError("Connect your wallet to continue.");
                        return;
                      }

                      if (!canPreview) {
                        setError(
                          "Enter a valid destination address and amount.",
                        );
                        return;
                      }

                      if (depositIdTrimmed && !depositIdValid) {
                        setError("Fix the depositId or leave it blank.");
                        return;
                      }

                      if (typeof crypto === "undefined") {
                        setError("Your browser does not support crypto APIs.");
                        return;
                      }

                      const depositId = depositIdTrimmed
                        ? (depositIdTrimmed as Hex)
                        : bytes32FromRandom();

                      addRecentDepositId(depositId);
                      toast({
                        title: "Draft saved",
                        description: "DepositId added to recent deposits.",
                        variant: "default",
                      });

                      window.location.href = `/deposit/${encodeURIComponent(depositId)}`;
                    }}
                  >
                    Preview / Track status
                  </Button>

                  <p className="text-xs text-muted-foreground">
                    This page currently creates a trackable depositId and links
                    you to the status screen. Submitting on-chain transactions
                    is a later step.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">Preview</h2>
                  <Badge
                    variant={
                      (canPreview ? ok("Ready") : pending("Pending")).variant
                    }
                  >
                    {(canPreview ? ok("Ready") : pending("Pending")).label}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  What will happen once this flow is wired to contract writes.
                </p>
              </CardHeader>

              <CardContent>
                <div className="space-y-3">
                  <div className="rounded-lg border border-border p-4">
                    <div className="text-xs text-muted-foreground">Wallet</div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <div className="truncate font-mono text-sm">
                        {address ?? "—"}
                      </div>
                      {address ? (
                        <CopyButton
                          value={address}
                          variant="secondary"
                          size="sm"
                        >
                          Copy
                        </CopyButton>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="text-xs text-muted-foreground">Steps</div>
                    <div className="mt-2 space-y-2 text-sm">
                      <div>1) Mint TokenA on Sepolia (issuer)</div>
                      <div>2) Send CCIP message on Sepolia (sender)</div>
                      <div>3) Receive on Base Sepolia (receiver)</div>
                      <div>4) Observe TokenB balance increase</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border p-4">
                    <div className="text-xs text-muted-foreground">Inputs</div>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="truncate">
                        <span className="text-muted-foreground">to:</span>{" "}
                        <span className="font-mono">{toTrimmed || "—"}</span>
                      </div>
                      <div className="truncate">
                        <span className="text-muted-foreground">amount:</span>{" "}
                        <span className="font-mono">{amountInput || "—"}</span>
                      </div>
                      <div className="truncate">
                        <span className="text-muted-foreground">
                          depositId:
                        </span>{" "}
                        <span className="font-mono">
                          {depositIdTrimmed || "(auto-generated)"}
                        </span>
                      </div>
                    </div>
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
