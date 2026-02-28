"use client";

import * as React from "react";

import { isE2eTest } from "@/lib/e2e";

const CONNECTED_KEY = "gr_e2e_wallet_connected";
const CHAIN_KEY = "gr_e2e_wallet_chain";

const DEFAULT_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

type E2eChain = "sepolia" | "baseSepolia";

function readConnected(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(CONNECTED_KEY) === "true";
}

function readChain(): E2eChain {
  if (typeof window === "undefined") return "sepolia";
  const v = window.localStorage.getItem(CHAIN_KEY);
  return v === "baseSepolia" ? "baseSepolia" : "sepolia";
}

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("gr:e2e-wallet"));
}

export function useE2eWallet() {
  const enabled = isE2eTest();

  const [isConnected, setIsConnected] = React.useState(false);
  const [chain, setChain] = React.useState<E2eChain>("sepolia");

  React.useEffect(() => {
    if (!enabled) return;

    const sync = () => {
      setIsConnected(readConnected());
      setChain(readChain());
    };

    sync();

    window.addEventListener("storage", sync);
    window.addEventListener("gr:e2e-wallet", sync);

    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("gr:e2e-wallet", sync);
    };
  }, [enabled]);

  const connect = React.useCallback(() => {
    if (!enabled || typeof window === "undefined") return;
    window.localStorage.setItem(CONNECTED_KEY, "true");
    notify();
  }, [enabled]);

  const disconnect = React.useCallback(() => {
    if (!enabled || typeof window === "undefined") return;
    window.localStorage.setItem(CONNECTED_KEY, "false");
    notify();
  }, [enabled]);

  const switchChain = React.useCallback(
    (next: E2eChain) => {
      if (!enabled || typeof window === "undefined") return;
      window.localStorage.setItem(CHAIN_KEY, next);
      notify();
    },
    [enabled],
  );

  return {
    enabled,
    isConnected,
    address: DEFAULT_ADDRESS,
    chain,
    connect,
    disconnect,
    switchChain,
  };
}
