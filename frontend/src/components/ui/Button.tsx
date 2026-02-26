import * as React from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline";
type Size = "sm" | "md";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", type = "button", ...props },
    ref,
  ) => {
    const base =
      "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

    const variants: Record<Variant, string> = {
      primary: "bg-foreground text-background hover:opacity-90",
      secondary: "bg-muted text-foreground hover:opacity-90",
      outline:
        "border border-border bg-background text-foreground hover:bg-muted",
    };

    const sizes: Record<Size, string> = {
      sm: "h-9 px-3",
      md: "h-10 px-4",
    };

    return (
      <button
        ref={ref}
        type={type}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
