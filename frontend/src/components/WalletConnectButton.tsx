"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { baseSepolia, sepolia } from "wagmi/chains";

import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { isE2eTest } from "@/lib/e2e";
import { useE2eWallet } from "@/lib/e2eWallet";
import { chains } from "@/lib/wagmi";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnectButton() {
  return isE2eTest() ? (
    <E2eWalletConnectButton />
  ) : (
    <WagmiWalletConnectButton />
  );
}

function E2eWalletConnectButton() {
  const { isConnected, address, chain, connect, disconnect, switchChain } =
    useE2eWallet();

  const chainLabel = chain === "baseSepolia" ? "Base Sepolia" : "Sepolia";

  if (isConnected) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-3">
          <CopyButton
            value={address}
            variant="secondary"
            size="sm"
            successTitle="Address copied"
          >
            {formatAddress(address)}
          </CopyButton>
          <Button variant="outline" size="sm" onClick={() => disconnect()}>
            Disconnect
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="default">{chainLabel}</Badge>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => switchChain("sepolia")}
          >
            Sepolia
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => switchChain("baseSepolia")}
          >
            Base Sepolia
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="primary" size="sm" onClick={() => connect()}>
      Connect wallet
    </Button>
  );
}

function WagmiWalletConnectButton() {
  const { isConnected, address, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const {
    switchChain,
    isPending: isSwitching,
    error: switchError,
  } = useSwitchChain();

  const activeChain = chainId ? chains.find((c) => c.id === chainId) : null;
  const isSupportedChain = Boolean(activeChain);

  if (isConnected) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-3">
          {address ? (
            <CopyButton
              value={address}
              variant="secondary"
              size="sm"
              successTitle="Address copied"
            >
              {formatAddress(address)}
            </CopyButton>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => disconnect()}>
            Disconnect
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={isSupportedChain ? "default" : "destructive"}>
            {activeChain?.name ??
              (chainId ? `Unsupported (${chainId})` : "Unknown")}
          </Badge>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => switchChain({ chainId: sepolia.id })}
            disabled={isSwitching}
          >
            Sepolia
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => switchChain({ chainId: baseSepolia.id })}
            disabled={isSwitching}
          >
            Base Sepolia
          </Button>
        </div>

        {switchError ? (
          <div className="text-xs text-muted-foreground">
            Failed to switch network.
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Button
      variant="primary"
      size="sm"
      onClick={() => connect({ connector: connectors[0] })}
      disabled={isPending || connectors.length === 0}
    >
      {isPending ? "Connecting..." : "Connect wallet"}
    </Button>
  );
}
