import * as React from "react";

import { cn } from "@/lib/cn";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground shadow-[var(--shadow-sm)]",
        className,
      )}
      {...props}
    />
  );
}

export type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;

export function CardHeader({ className, ...props }: CardHeaderProps) {
  return <div className={cn("p-[var(--space-6)]", className)} {...props} />;
}

export type CardContentProps = React.HTMLAttributes<HTMLDivElement>;

export function CardContent({ className, ...props }: CardContentProps) {
  return (
    <div
      className={cn("px-[var(--space-6)] pb-[var(--space-6)]", className)}
      {...props}
    />
  );
}
