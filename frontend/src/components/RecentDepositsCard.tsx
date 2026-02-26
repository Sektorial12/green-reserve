"use client";

import * as React from "react";

import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import {
  getRecentDepositIds,
  clearRecentDepositIds,
} from "@/lib/depositHistory";

export function RecentDepositsCard() {
  const [items, setItems] = React.useState<string[]>([]);

  React.useEffect(() => {
    setItems(getRecentDepositIds());
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Recent deposits</h2>
            <Badge>{items.length}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored locally in this browser.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            clearRecentDepositIds();
            setItems([]);
          }}
          disabled={items.length === 0}
        >
          Clear
        </Button>
      </CardHeader>

      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent deposits.</p>
        ) : (
          <div className="space-y-2">
            {items.map((depositId) => (
              <div
                key={depositId}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <a
                  href={`/deposit/${encodeURIComponent(depositId)}`}
                  className="truncate font-mono text-sm underline-offset-4 hover:underline"
                >
                  {depositId}
                </a>
                <div className="flex items-center gap-2">
                  <CopyButton value={depositId} variant="secondary" size="sm">
                    Copy
                  </CopyButton>
                  <a
                    href={`/deposit/${encodeURIComponent(depositId)}`}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    Open
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
