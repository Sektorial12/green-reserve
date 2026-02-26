"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/Button";

function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnectButton() {
  const { isConnected, address } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
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
