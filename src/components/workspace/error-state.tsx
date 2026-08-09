"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one rendered error surface for workspace panels.
 *
 * Before this existed, a failed fetch in a table-detail tab produced either a
 * toast that vanished or an unhandled promise rejection, and the panel sat on
 * its loading skeleton forever. `role="alert"` plus the `text-destructive`
 * class token are both load-bearing: e2e/sql-workspaces.spec.ts asserts on
 * exactly that selector when it clicks through every tab.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="size-4 mt-px shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{title}</div>
          <div className="mt-0.5 text-[11.5px] font-mono break-words text-destructive/85">
            {message}
          </div>
        </div>
        {onRetry ? (
          <Button size="xs" variant="outline" onClick={onRetry} className="shrink-0">
            <RotateCw className="size-3" />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
