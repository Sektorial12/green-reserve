import * as React from "react";

import { cn } from "@/lib/cn";

type Variant = "default" | "success" | "destructive";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  const variants: Record<Variant, string> = {
    default: "border-border bg-muted text-muted-foreground",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    destructive:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
