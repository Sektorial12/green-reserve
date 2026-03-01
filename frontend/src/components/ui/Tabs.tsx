"use client";

import * as React from "react";

import { cn } from "@/lib/cn";

type TabsContextValue = {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
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
  const baseId = React.useId();

  const currentValue = value ?? internalValue;

  const setValue = React.useCallback(
    (v: string) => {
      setInternalValue(v);
      onValueChange?.(v);
    },
    [onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value: currentValue, setValue, baseId }}>
      <div className={cn("space-y-3", className)} {...props} />
    </TabsContext.Provider>
  );
}

export type TabsListProps = React.HTMLAttributes<HTMLDivElement>;

export function TabsList({ className, ...props }: TabsListProps) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
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
  const triggerId = `${ctx.baseId}-trigger-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;

  const { onClick, onKeyDown, ...rest } = props;

  return (
    <button
      type="button"
      id={triggerId}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-[var(--radius-sm)] px-3 text-sm font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      onClick={(e) => {
        ctx.setValue(value);
        onClick?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (
          e.key !== "ArrowLeft" &&
          e.key !== "ArrowRight" &&
          e.key !== "Home" &&
          e.key !== "End"
        ) {
          return;
        }

        const tablist = e.currentTarget.closest('[role="tablist"]');
        const tabs = tablist
          ? Array.from(tablist.querySelectorAll('[role="tab"]'))
          : [];
        const index = tabs.indexOf(e.currentTarget);
        if (index === -1 || tabs.length === 0) return;

        let nextIndex = index;
        if (e.key === "Home") nextIndex = 0;
        if (e.key === "End") nextIndex = tabs.length - 1;
        if (e.key === "ArrowLeft")
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (e.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;

        const next = tabs[nextIndex] as HTMLButtonElement | undefined;
        if (!next) return;
        next.click();
        next.focus();
        e.preventDefault();
      }}
      {...rest}
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

  const triggerId = `${ctx.baseId}-trigger-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={triggerId}
      className={cn(className)}
      {...props}
    />
  );
}
