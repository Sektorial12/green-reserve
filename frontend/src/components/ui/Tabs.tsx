"use client";

import * as React from "react";

import { cn } from "@/lib/cn";

type TabsContextValue = {
  value: string;
  setValue: (v: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

export type TabsProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
};

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");

  const currentValue = value ?? internalValue;

  const setValue = React.useCallback(
    (v: string) => {
      setInternalValue(v);
      onValueChange?.(v);
    },
    [onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value: currentValue, setValue }}>
      <div className={cn("space-y-3", className)} {...props} />
    </TabsContext.Provider>
  );
}

export type TabsListProps = React.HTMLAttributes<HTMLDivElement>;

export function TabsList({ className, ...props }: TabsListProps) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border bg-background p-1",
        className,
      )}
      {...props}
    />
  );
}

export type TabsTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

export function TabsTrigger({ value, className, ...props }: TabsTriggerProps) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger must be used within Tabs");

  const active = ctx.value === value;

  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-[var(--radius-sm)] px-3 text-sm font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      onClick={() => ctx.setValue(value)}
      {...props}
    />
  );
}

export type TabsContentProps = React.HTMLAttributes<HTMLDivElement> & {
  value: string;
};

export function TabsContent({ value, className, ...props }: TabsContentProps) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent must be used within Tabs");

  if (ctx.value !== value) return null;

  return <div className={cn(className)} {...props} />;
}
