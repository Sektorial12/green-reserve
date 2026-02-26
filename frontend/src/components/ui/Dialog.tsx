"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

type DialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

export type DialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: DialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(Boolean(defaultOpen));
  const isOpen = open ?? internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  return (
    <DialogContext.Provider value={{ open: isOpen, setOpen }}>
      {children}
    </DialogContext.Provider>
  );
}

export type DialogTriggerProps =
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
  };

export function DialogTrigger({ asChild, ...props }: DialogTriggerProps) {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("DialogTrigger must be used within Dialog");

  if (asChild && React.isValidElement(props.children)) {
    const child =
      props.children as React.ReactElement<React.HTMLAttributes<HTMLElement>>;

    return React.cloneElement(child, {
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(e);
        ctx.setOpen(true);
      },
    });
  }

  return <button type="button" onClick={() => ctx.setOpen(true)} {...props} />;
}

export type DialogContentProps = React.HTMLAttributes<HTMLDivElement>;

export function DialogContent({ className, ...props }: DialogContentProps) {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("DialogContent must be used within Dialog");

  if (!ctx.open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => ctx.setOpen(false)}
      />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div
          className={cn(
            "w-full max-w-lg rounded-[var(--radius-lg)] border border-border bg-card p-6 text-card-foreground shadow-[var(--shadow-md)]",
            className,
          )}
          {...props}
        />
      </div>
    </div>,
    document.body,
  );
}

export type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement>;

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div className={cn("space-y-1", className)} {...props} />;
}

export type DialogTitleProps = React.HTMLAttributes<HTMLHeadingElement>;

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return <h3 className={cn("text-base font-semibold", className)} {...props} />;
}

export type DialogDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export function DialogDescription({
  className,
  ...props
}: DialogDescriptionProps) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export type DialogCloseProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function DialogClose({ className, ...props }: DialogCloseProps) {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("DialogClose must be used within Dialog");

  return (
    <button
      type="button"
      className={cn(
        "rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted",
        className,
      )}
      onClick={() => ctx.setOpen(false)}
      {...props}
    />
  );
}
