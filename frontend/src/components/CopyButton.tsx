"use client";

import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export type CopyButtonProps = Omit<ButtonProps, "onClick"> & {
  value: string;
  successTitle?: string;
  successDescription?: string;
  errorTitle?: string;
  errorDescription?: string;
};

export function CopyButton({
  value,
  successTitle = "Copied",
  successDescription,
  errorTitle = "Copy failed",
  errorDescription = "Your browser blocked clipboard access.",
  children,
  ...props
}: CopyButtonProps) {
  const { toast } = useToast();

  return (
    <Button
      {...props}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast({
            title: successTitle,
            description: successDescription,
            variant: "default",
          });
        } catch {
          toast({
            title: errorTitle,
            description: errorDescription,
            variant: "destructive",
          });
        }
      }}
    >
      {children ?? "Copy"}
    </Button>
  );
}
