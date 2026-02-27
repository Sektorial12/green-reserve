"use client";

import * as React from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  title?: string;
  description?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <Card>
        <CardHeader>
          <div className="text-base font-semibold">
            {this.props.title ?? "This section crashed"}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {this.props.description ??
              "Try again, or refresh the page if the problem persists."}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button onClick={this.reset}>Try again</Button>
            <Button
              variant="outline"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload page
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.href = "/";
              }}
            >
              Go home
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
    );
  }
}
