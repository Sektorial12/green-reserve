"use client";

import * as React from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <Container className="py-[var(--space-10)]">
          <Card>
            <CardHeader>
              <div className="text-lg font-semibold">Application error</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Something went wrong at the application level.
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => reset()}>Try again</Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.href = "/";
                  }}
                >
                  Go home
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  Reload
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
      </body>
    </html>
  );
}
