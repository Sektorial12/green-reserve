"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Container className="py-[var(--space-10)]">
      <Card>
        <CardHeader>
          <div className="text-lg font-semibold">Something went wrong</div>
          <div className="mt-1 text-sm text-muted-foreground">
            An unexpected error occurred while rendering this page.
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => reset()}>Try again</Button>
            <Button variant="outline" onClick={() => router.push("/")}>
              Go home
            </Button>
            <Button variant="secondary" onClick={() => router.refresh()}>
              Refresh data
            </Button>
          </div>

          {error.message ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-muted p-3 text-sm">
              <div className="font-medium">Error</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {error.message}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Container>
  );
}
