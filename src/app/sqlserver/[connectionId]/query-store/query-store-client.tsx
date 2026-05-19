"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { Pin, PinOff, RefreshCcw } from "lucide-react";

interface QSQuery {
  queryId: number;
  planId: number;
  text: string;
  executionCount: number;
  avgDurationMs: number;
  avgCpuMs: number;
  avgLogicalReads: number;
  isForced: boolean;
}
interface Payload {
  database: string;
  status: { enabled: boolean; state: string | null };
  top: QSQuery[];
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function QueryStoreClient({
  connectionId,
  defaultDatabase,
}: {
  connectionId: string;
  defaultDatabase: string;
}) {
  const [database, setDatabase] = useState(defaultDatabase);
  const [databases, setDatabases] = useState<string[]>([defaultDatabase]);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetch(`/api/sqlserver/${connectionId}/databases`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        if (d.databases) setDatabases(d.databases.map((x: { name: string }) => x.name));
      })
      .catch(() => {});
  }, [connectionId]);

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/query-store?db=${encodeURIComponent(database)}`,
        { cache: "no-store" },
      );
      const d = await res.json();
      if (res.ok) setData(d as Payload);
      else toast.error("Could not load Query Store", { description: d.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleForce = async (q: QSQuery) => {
    const res = await fetch(`/api/sqlserver/${connectionId}/query-store/force`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        db: database,
        queryId: q.queryId,
        planId: q.planId,
        forced: !q.isForced,
      }),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success(q.isForced ? "Plan unforced" : "Plan forced");
      await load();
    } else {
      toast.error(d.error || "Action failed");
    }
  };

  return (
    <WorkspacePage
      title="Query Store"
      description="Top queries by avg CPU from the database's Query Store — with one-click plan force/unforce."
      actions={
        <div className="flex items-center gap-2">
          <Select value={database} onValueChange={(v) => v && setDatabase(v)}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {databases.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCcw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            Refresh
          </Button>
        </div>
      }
    >
      {!data ? (
        <Skeleton className="h-60 w-full" />
      ) : !data.status.enabled ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-400">
          Query Store is not enabled for <span className="font-mono">{database}</span>{" "}
          (state: {data.status.state ?? "OFF"}). Enable it with{" "}
          <span className="font-mono">ALTER DATABASE [{database}] SET QUERY_STORE = ON</span>.
        </div>
      ) : data.top.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runtime stats captured yet.</p>
      ) : (
        <div className="space-y-2">
          {data.top.map((q) => (
            <details key={`${q.queryId}-${q.planId}`} className="rounded-lg border border-border/60 bg-card/40">
              <summary className="cursor-pointer flex items-center gap-3 px-3 py-2 text-xs font-mono">
                <span className="text-muted-foreground">q{q.queryId}</span>
                <span className="flex-1 truncate">{q.text.split("\n")[0]}</span>
                {q.isForced ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600">
                    <Pin className="size-3" /> forced
                  </span>
                ) : null}
                <span className="text-amber-600 tabular-nums w-16 text-right">{fmtMs(q.avgCpuMs)}</span>
                <span className="text-muted-foreground tabular-nums w-16 text-right">×{q.executionCount.toLocaleString()}</span>
              </summary>
              <div className="px-3 pb-3 border-t border-border/40 space-y-2">
                <div className="flex gap-4 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <span>avg dur {fmtMs(q.avgDurationMs)}</span>
                  <span>avg cpu {fmtMs(q.avgCpuMs)}</span>
                  <span>avg reads {Math.round(q.avgLogicalReads).toLocaleString()}</span>
                  <span>plan {q.planId}</span>
                </div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-muted/30 rounded p-2 max-h-60 overflow-auto">
                  {q.text}
                </pre>
                <Button
                  size="xs"
                  variant={q.isForced ? "outline" : "default"}
                  onClick={() => toggleForce(q)}
                  className="gap-1"
                >
                  {q.isForced ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                  {q.isForced ? "Unforce plan" : "Force plan"}
                </Button>
              </div>
            </details>
          ))}
        </div>
      )}
    </WorkspacePage>
  );
}
