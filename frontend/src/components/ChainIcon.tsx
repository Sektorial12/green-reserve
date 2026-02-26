import * as React from "react";

import { cn } from "@/lib/cn";

export type ChainKey = "sepolia" | "baseSepolia";

export type ChainIconProps = React.HTMLAttributes<HTMLSpanElement> & {
  chain: ChainKey;
};

export function ChainIcon({ chain, className, ...props }: ChainIconProps) {
  const label = chain === "sepolia" ? "Sep" : "Base";

  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold text-foreground",
        className,
      )}
      aria-label={chain}
      title={chain}
      {...props}
    >
      {label}
    </span>
  );
}
