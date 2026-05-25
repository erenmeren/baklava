"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { toast } from "sonner";

interface Query {
  text: string;
  executionCount: number;
  totalWorkerTimeMs: number;
  avgWorkerTimeMs: number;
  totalLogicalReads: number;
  avgLogicalReads: number;
  lastExecution: string | null;
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function ExpensiveQueriesClient({ connectionId }: { connectionId: string }) {
  const [queries, setQueries] = useState<Query[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/expensive-queries`, {
        cache: "no-store",
      });
      const d = await res.json();
      if (res.ok) setQueries(d.queries as Query[]);
      else toast.error("Could not load", { description: d.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <WorkspacePage
      title="Top queries"
      description="Plan-cache queries ranked by total CPU — the parameterized SQL your apps and ORMs actually ran (sys.dm_exec_query_stats)."
      actions={
        <RefreshButton onClick={load} loading={loading} />
      }
    >
      {!queries ? (
        <Skeleton className="h-60 w-full" />
      ) : queries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cached query stats — the plan cache may have been cleared.
        </p>
      ) : (
        <div className="space-y-2">
          {queries.map((q, i) => (
            <details
              key={i}
              className="rounded-lg border border-border/60 bg-card/40"
            >
              <summary className="cursor-pointer flex items-center gap-3 px-3 py-2 text-xs font-mono">
                <span className="text-muted-foreground w-6 text-right">{i + 1}</span>
                <span className="flex-1 truncate">{q.text.split("\n")[0]}</span>
                <span className="text-amber-600 tabular-nums w-20 text-right">
                  {fmtMs(q.totalWorkerTimeMs)}
                </span>
                <span className="text-muted-foreground tabular-nums w-16 text-right">
                  ×{q.executionCount.toLocaleString()}
                </span>
                <span className="text-sky-600 tabular-nums w-24 text-right">
                  {q.totalLogicalReads.toLocaleString()} rd
                </span>
              </summary>
              <div className="px-3 pb-3 border-t border-border/40">
                <div className="flex gap-4 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <span>avg cpu {fmtMs(q.avgWorkerTimeMs)}</span>
                  <span>avg reads {Math.round(q.avgLogicalReads).toLocaleString()}</span>
                  {q.lastExecution ? (
                    <span>last {new Date(q.lastExecution).toLocaleString()}</span>
                  ) : null}
                </div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-muted/30 rounded p-2 max-h-60 overflow-auto">
                  {q.text}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </WorkspacePage>
  );
}
