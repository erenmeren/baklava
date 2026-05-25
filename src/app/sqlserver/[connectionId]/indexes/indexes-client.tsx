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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertTriangle, Copy, Loader2, Wrench } from "lucide-react";
import { RefreshButton } from "@/components/workspace/auto-refresh";

interface Fragmentation {
  schema: string;
  table: string;
  index: string;
  indexType: string;
  fragmentationPct: number;
  pageCount: number;
  recommendation: "none" | "reorganize" | "rebuild";
}
interface MissingIndex {
  schema: string;
  table: string;
  impact: number;
  userSeeks: number;
  createStatement: string;
}
interface Payload {
  database: string;
  fragmentation: Fragmentation[];
  missing: MissingIndex[];
}

export function IndexesClient({
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
  const [busy, setBusy] = useState<string | null>(null);

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
        `/api/sqlserver/${connectionId}/indexes?db=${encodeURIComponent(database)}`,
        { cache: "no-store" },
      );
      const d = await res.json();
      if (res.ok) setData(d as Payload);
      else toast.error("Could not load indexes", { description: d.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    void load();
  }, [load]);

  const maintain = async (f: Fragmentation, action: "rebuild" | "reorganize") => {
    const key = `${f.schema}.${f.table}.${f.index}`;
    setBusy(key);
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/indexes/maintain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          db: database,
          schema: f.schema,
          table: f.table,
          index: f.index,
          action,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success(`${action === "rebuild" ? "Rebuilt" : "Reorganized"} ${f.index}`);
        await load();
      } else {
        toast.error(d.error || "Action failed");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <WorkspacePage
      title="Index maintenance"
      description="Fragmentation (sys.dm_db_index_physical_stats) + missing-index recommendations the engine itself suggests."
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
          <RefreshButton onClick={load} loading={loading} />
        </div>
      }
    >
      {!data ? (
        <Skeleton className="h-60 w-full" />
      ) : (
        <div className="space-y-6">
          {/* Missing indexes */}
          {data.missing.length > 0 ? (
            <section>
              <h2 className="text-xs uppercase tracking-wider font-mono text-amber-700 dark:text-amber-400 mb-2 inline-flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                Missing indexes ({data.missing.length})
              </h2>
              <div className="space-y-1.5">
                {data.missing.map((m, i) => (
                  <div key={i} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                    <div className="flex items-center justify-between mb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      <span>
                        {m.schema}.{m.table} · impact {m.impact.toFixed(0)}% · {m.userSeeks.toLocaleString()} seeks
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(m.createStatement);
                          toast.success("Copied");
                        }}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <Copy className="size-3" /> copy
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words">
                      {m.createStatement}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Fragmentation */}
          <section>
            <h2 className="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2 inline-flex items-center gap-1.5">
              <Wrench className="size-3.5" />
              Fragmentation ({data.fragmentation.length} indexes ≥ 100 pages)
            </h2>
            {data.fragmentation.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No indexes above the page threshold — nothing to maintain.
              </p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Index</TableHead>
                      <TableHead>Table</TableHead>
                      <TableHead className="text-right">Frag %</TableHead>
                      <TableHead className="text-right">Pages</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.fragmentation.map((f) => {
                      const key = `${f.schema}.${f.table}.${f.index}`;
                      return (
                        <TableRow
                          key={key}
                          className={cn(
                            f.recommendation === "rebuild" && "bg-rose-500/5",
                            f.recommendation === "reorganize" && "bg-amber-500/5",
                          )}
                        >
                          <TableCell className="font-mono text-xs">{f.index}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {f.schema}.{f.table}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-mono text-xs tabular-nums",
                              f.fragmentationPct > 30
                                ? "text-rose-600"
                                : f.fragmentationPct > 5
                                  ? "text-amber-600"
                                  : "text-muted-foreground",
                            )}
                          >
                            {f.fragmentationPct.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                            {f.pageCount.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {f.recommendation === "none" ? (
                              <span className="text-[10px] font-mono text-muted-foreground/60">ok</span>
                            ) : (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={busy === key}
                                onClick={() =>
                                  maintain(
                                    f,
                                    f.recommendation === "rebuild" ? "rebuild" : "reorganize",
                                  )
                                }
                                className="gap-1"
                              >
                                {busy === key ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Wrench className="size-3" />
                                )}
                                {f.recommendation === "rebuild" ? "Rebuild" : "Reorganize"}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      )}
    </WorkspacePage>
  );
}
