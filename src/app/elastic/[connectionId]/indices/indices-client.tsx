"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { formatBytes } from "@/components/workspace/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

type Health = "green" | "yellow" | "red" | "unknown";

interface IndexRow {
  name: string;
  health: Health;
  docCount: number;
  storeSize: number;
  primaries: number;
  replicas: number;
  system: boolean;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "docs" | "size";
type SortDir = "asc" | "desc";

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

const HEALTH_DOT: Record<Health, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  unknown: "bg-muted-foreground/40",
};

const HEALTH_TEXT: Record<Health, string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  yellow: "text-amber-700 dark:text-amber-300",
  red: "text-red-700 dark:text-red-300",
  unknown: "text-muted-foreground",
};

export function IndicesClient({ connectionId }: Props) {
  const [indices, setIndices] = useState<IndexRow[] | null>(null);
  const [includeSystem, setIncludeSystem] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "docs",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/elastic/${connectionId}/indices`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setIndices(data.indices as IndexRow[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!indices) return null;
    const q = search.trim().toLowerCase();
    let out = indices;
    if (!includeSystem) out = out.filter((i) => !i.system);
    if (q) out = out.filter((i) => i.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "docs") return (a.docCount - b.docCount) * mult;
      return (a.storeSize - b.storeSize) * mult;
    });
    return out;
  }, [indices, search, includeSystem, sort]);

  const maxDocs = useMemo(
    () => indices?.reduce((m, t) => Math.max(m, t.docCount), 0) ?? 0,
    [indices]
  );

  const totalDocs = useMemo(
    () => indices?.reduce((s, t) => s + t.docCount, 0) ?? 0,
    [indices]
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
      title="Indices"
      description={
        filtered && indices
          ? filtered.length === indices.length
            ? `${indices.length} ${indices.length === 1 ? "index" : "indices"} · ${formatCompact(totalDocs)} docs`
            : `${filtered.length} of ${indices.length}`
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
        {/* ── Filter strip ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search indices…"
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

        {/* ── Indices table ─────────────────────────────────────────────── */}
        {indices === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {indices.length === 0
              ? "No indices yet."
              : "No indices match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Index"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <th className="px-3 py-2 text-left w-[100px]">Health</th>
                  <SortableTh
                    label="Docs"
                    keyName="docs"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[28%]"
                  />
                  <SortableTh
                    label="Size"
                    keyName="size"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[110px]"
                  />
                  <th className="px-3 py-2 text-left w-[70px]">Pri</th>
                  <th className="px-3 py-2 text-left w-[70px]">Rep</th>
                </tr>
              </thead>
              <tbody>
                {filtered!.map((idx) => (
                  <IndexRowItem
                    key={idx.name}
                    idx={idx}
                    maxDocs={maxDocs}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function IndexRowItem({
  idx,
  maxDocs,
}: {
  idx: IndexRow;
  maxDocs: number;
}) {
  const pct =
    maxDocs > 0 ? Math.min(100, (idx.docCount / maxDocs) * 100) : 0;
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs truncate">{idx.name}</span>
          {idx.system ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-border/60"
            >
              system
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider",
            HEALTH_TEXT[idx.health]
          )}
        >
          <span
            className={cn("size-1.5 rounded-full", HEALTH_DOT[idx.health])}
          />
          {idx.health}
        </span>
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums w-14 text-right text-muted-foreground">
            {formatCompact(idx.docCount)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                idx.docCount === 0
                  ? "bg-muted"
                  : "bg-gradient-to-r from-teal-500/70 to-cyan-500/70"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums text-muted-foreground">
        {formatBytes(idx.storeSize)}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {idx.primaries}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {idx.replicas}
      </td>
    </tr>
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
