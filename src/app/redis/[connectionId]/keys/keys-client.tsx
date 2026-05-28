"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KeyViewer } from "./key-viewer";

interface Props {
  connectionId: string;
  isCluster: boolean;
  defaultDb: number;
}

interface KeyRow {
  key: string;
  type: string;
  ttl: number;
  size: number;
}

interface KeysPage {
  keys: KeyRow[];
  scanned: number;
  truncated: boolean;
}

const TYPE_COLOR: Record<string, string> = {
  string: "text-emerald-600 dark:text-emerald-400",
  hash: "text-cyan-600 dark:text-cyan-400",
  list: "text-violet-600 dark:text-violet-400",
  set: "text-amber-600 dark:text-amber-400",
  zset: "text-fuchsia-600 dark:text-fuchsia-400",
  stream: "text-rose-600 dark:text-rose-400",
  "ReJSON-RL": "text-indigo-600 dark:text-indigo-400",
};

function formatTtl(ttl: number): string {
  if (ttl === -1) return "—";
  if (ttl === -2) return "missing";
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
  return `${Math.floor(ttl / 86400)}d`;
}

function formatBytes(b: number): string {
  if (b === 0) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 ** 2).toFixed(1)}MB`;
}

export function KeysClient({ connectionId, isCluster, defaultDb }: Props) {
  const [pattern, setPattern] = useState("*");
  const [appliedPattern, setAppliedPattern] = useState("*");
  const [db, setDb] = useState(defaultDb);
  const [page, setPage] = useState<KeysPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (appliedPattern) params.set("pattern", appliedPattern);
      if (!isCluster) params.set("db", String(db));
      const res = await fetch(
        `/api/redis/${connectionId}/keys?${params.toString()}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `keys failed (${res.status})`);
      setPage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [appliedPattern, connectionId, db, isCluster]);

  useEffect(() => {
    load();
  }, [load]);

  const total = page?.keys.length ?? 0;
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of page?.keys ?? []) {
      m.set(k.type, (m.get(k.type) ?? 0) + 1);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [page]);

  async function handleDelete(key: string) {
    if (!confirm(`Delete key "${key}"?`)) return;
    try {
      const params = new URLSearchParams();
      if (!isCluster) params.set("db", String(db));
      const res = await fetch(
        `/api/redis/${connectionId}/key/${encodeURIComponent(key)}?${params.toString()}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `delete failed (${res.status})`);
      }
      toast.success("Key deleted");
      if (selected === key) setSelected(null);
      load();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <WorkspacePage
      title="Keys"
      description={`Browse the keyspace with SCAN. Pattern filtering uses glob syntax (* ? [ ]).`}
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      }
    >
      <div className="flex flex-col gap-4 h-full min-h-0">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px] space-y-1">
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Pattern
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/70" />
              <Input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setAppliedPattern(pattern);
                }}
                className="pl-8 font-mono"
                spellCheck={false}
              />
            </div>
          </div>
          {!isCluster ? (
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                DB
              </label>
              <Input
                type="number"
                min={0}
                max={15}
                className="w-20 font-mono"
                value={db}
                onChange={(e) => setDb(Number(e.target.value) || 0)}
              />
            </div>
          ) : null}
          <Button onClick={() => setAppliedPattern(pattern)}>Apply</Button>
        </div>

        {error ? (
          <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-sm px-3 py-2 font-mono">
            {error}
          </div>
        ) : null}

        {page?.truncated ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300 text-xs px-3 py-2">
            Scan capped at 100,000 keys — refine the pattern to see the rest.
          </div>
        ) : null}

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
          <span>
            <span className="text-foreground tabular-nums">{total}</span> keys
          </span>
          <span>
            scanned{" "}
            <span className="text-foreground tabular-nums">
              {page?.scanned ?? 0}
            </span>
          </span>
          {typeCounts.map(([t, n]) => (
            <span key={t} className={cn(TYPE_COLOR[t] ?? "text-muted-foreground")}>
              {t} <span className="tabular-nums">{n}</span>
            </span>
          ))}
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,360px)_1fr] gap-4">
          <div className="border border-border/60 rounded-md overflow-hidden flex flex-col min-h-0">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/60 bg-muted/30">
              <span>key</span>
              <span>ttl</span>
              <span>size</span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto font-mono text-xs">
              {page?.keys.length === 0 ? (
                <div className="px-4 py-12 text-center text-muted-foreground text-xs">
                  no keys match {appliedPattern}
                </div>
              ) : (
                page?.keys.map((k) => (
                  <button
                    key={k.key}
                    onClick={() => setSelected(k.key)}
                    className={cn(
                      "w-full text-left grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 border-l-2 transition-colors",
                      selected === k.key
                        ? "border-rose-500 bg-rose-500/8 text-foreground"
                        : "border-transparent hover:bg-foreground/[0.03]",
                    )}
                  >
                    <span className="truncate" title={k.key}>
                      <span
                        className={cn(
                          "mr-2 text-[10px] uppercase",
                          TYPE_COLOR[k.type] ?? "text-muted-foreground",
                        )}
                      >
                        {k.type}
                      </span>
                      {k.key}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatTtl(k.ttl)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatBytes(k.size)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="border border-border/60 rounded-md overflow-hidden flex flex-col min-h-0">
            {selected ? (
              <KeyViewer
                connectionId={connectionId}
                keyName={selected}
                db={isCluster ? undefined : db}
                onDelete={() => handleDelete(selected)}
                onMutate={load}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                select a key
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspacePage>
  );
}

