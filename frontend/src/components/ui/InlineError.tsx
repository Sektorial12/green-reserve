import * as React from "react";

import { cn } from "@/lib/cn";

export type InlineErrorProps = React.HTMLAttributes<HTMLDivElement>;

export function InlineError({ className, ...props }: InlineErrorProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
        className,
      )}
      {...props}
    />
  );
}
