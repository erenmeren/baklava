"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

interface TableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  estimatedBytes: number;
  system: boolean;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "size" | "rows" | "columns";
type SortDir = "asc" | "desc";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

export function TablesClient({ connectionId }: Props) {
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [includeSystem, setIncludeSystem] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "size",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sqlite/${connectionId}/tables`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setTables(data.tables as TableSummary[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!tables) return null;
    const q = search.trim().toLowerCase();
    let out = tables;
    if (!includeSystem) out = out.filter((t) => !t.system);
    if (q) out = out.filter((t) => t.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "size") return (a.estimatedBytes - b.estimatedBytes) * mult;
      if (sort.key === "rows") return (a.rowCount - b.rowCount) * mult;
      return (a.columnCount - b.columnCount) * mult;
    });
    return out;
  }, [tables, search, includeSystem, sort]);

  const maxSize = useMemo(
    () => tables?.reduce((m, t) => Math.max(m, t.estimatedBytes), 0) ?? 0,
    [tables]
  );

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  return (
    <WorkspacePage
      title="Tables"
      description={
        filtered && tables
          ? filtered.length === tables.length
            ? `${tables.length} table${tables.length === 1 ? "" : "s"} · ${formatCompact(tables.reduce((s, t) => s + t.rowCount, 0))} rows`
            : `${filtered.length} of ${tables.length}`
          : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tables…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              id="show-system"
              size="sm"
              checked={includeSystem}
              onCheckedChange={setIncludeSystem}
            />
            <Label
              htmlFor="show-system"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Show system
            </Label>
          </div>
        </div>

        {tables === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {tables.length === 0
              ? "No tables in this database."
              : "No tables match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Table"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <SortableTh
                    label="Size"
                    keyName="size"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[28%]"
                  />
                  <SortableTh
                    label="Rows"
                    keyName="rows"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[100px]"
                  />
                  <SortableTh
                    label="Cols"
                    keyName="columns"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[80px]"
                  />
                </tr>
              </thead>
              <tbody>
                {filtered!.map((t) => {
                  const pct =
                    maxSize > 0
                      ? Math.min(100, (t.estimatedBytes / maxSize) * 100)
                      : 0;
                  const isEmpty = t.rowCount === 0;
                  return (
                    <tr
                      key={t.name}
                      className="border-t border-border/40 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link
                            href={`/sqlite/${connectionId}/tables/${encodeURIComponent(t.name)}`}
                            className="font-mono text-xs hover:underline truncate"
                          >
                            {t.name}
                          </Link>
                          {t.system ? (
                            <Badge
                              variant="secondary"
                              className="text-[9px] font-mono uppercase tracking-wider"
                            >
                              system
                            </Badge>
                          ) : null}
                          {isEmpty ? (
                            <Badge
                              variant="outline"
                              className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-border/60"
                            >
                              empty
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs tabular-nums w-20 text-right text-muted-foreground">
                            {formatBytes(t.estimatedBytes)}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                t.estimatedBytes === 0
                                  ? "bg-muted"
                                  : "bg-gradient-to-r from-blue-500/70 to-indigo-500/70"
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
                        {formatCompact(t.rowCount)}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
                        {t.columnCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

function SortableTh({
  label,
  keyName,
  sort,
  onClick,
  className,
}: {
  label: string;
  keyName: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onClick: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === keyName;
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onClick(keyName)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          active && "text-foreground"
        )}
      >
        {label}
        <ArrowDownUp
          className={cn(
            "size-3 opacity-0 transition-opacity",
            active && "opacity-60"
          )}
        />
      </button>
    </th>
  );
}
