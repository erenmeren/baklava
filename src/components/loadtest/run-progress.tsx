"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronDown, ChevronRight, X } from "lucide-react";

export function RunProgress({
  elapsedMs,
  vus,
  iterations,
  lines,
  onCancel,
}: {
  elapsedMs: number;
  vus?: number;
  iterations?: number;
  lines: string[];
  onCancel: () => void;
}) {
  const [showOutput, setShowOutput] = useState(false);
  const secs = (elapsedMs / 1000).toFixed(1);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Loader2 className="size-4 animate-spin text-amber-500" />
          <div className="flex items-center gap-4 text-sm tabular-nums">
            <span><span className="text-muted-foreground">elapsed</span> {secs}s</span>
            <span><span className="text-muted-foreground">VUs</span> {vus ?? "—"}</span>
            <span><span className="text-muted-foreground">iterations</span> {iterations ?? 0}</span>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="size-3.5" />
          Cancel
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setShowOutput((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showOutput ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Show output
      </button>

      {showOutput ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-[11px] font-mono leading-relaxed">
          {lines.length ? lines.join("\n") : "waiting for k6 output…"}
        </pre>
      ) : null}
    </Card>
  );
}
