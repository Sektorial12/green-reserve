import * as React from "react";

import { cn } from "@/lib/cn";

export type ContainerProps = React.HTMLAttributes<HTMLDivElement>;

export function Container({ className, ...props }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full max-w-4xl px-[var(--space-6)]", className)}
      {...props}
    />
  );
}
