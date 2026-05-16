"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowDownUp, ArrowLeft, RefreshCcw, Search } from "lucide-react";

interface CollectionSummary {
  name: string;
  type: "collection" | "view" | "timeSeries";
  docCount: number;
  storageBytes: number;
  avgDocSize: number;
  indexCount: number;
}

interface DatabaseDetail {
  database: {
    name: string;
    sizeBytes: number;
    collectionCount: number;
    indexCount: number;
    docCount: number;
  };
  collections: CollectionSummary[];
}

interface Props {
  connectionId: string;
  database: string;
}

type SortKey = "name" | "size" | "docs" | "avg" | "indexes";
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
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

export function DatabaseDetailClient({ connectionId, database }: Props) {
  const [detail, setDetail] = useState<DatabaseDetail | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "size",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/mongo/${connectionId}/databases/${encodeURIComponent(database)}/collections`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setDetail(data as DatabaseDetail);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, database]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh every 15s like other overview pages.
  useEffect(() => {
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!detail) return null;
    const q = search.trim().toLowerCase();
    let out = detail.collections;
    if (q) out = out.filter((c) => c.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "size") return (a.storageBytes - b.storageBytes) * mult;
      if (sort.key === "docs") return (a.docCount - b.docCount) * mult;
      if (sort.key === "avg") return (a.avgDocSize - b.avgDocSize) * mult;
      return (a.indexCount - b.indexCount) * mult;
    });
    return out;
  }, [detail, search, sort]);

  const maxSize = useMemo(
    () =>
      detail?.collections.reduce((m, c) => Math.max(m, c.storageBytes), 0) ?? 0,
    [detail]
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
      title={<span className="font-mono">{database}</span>}
      description={
        detail
          ? `${detail.database.collectionCount} collection${detail.database.collectionCount === 1 ? "" : "s"} · ${formatBytes(detail.database.sizeBytes)}`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/mongo/${connectionId}/databases`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Aggregate stat pills */}
        {detail ? (
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            <StatPill label="Docs" value={formatCompact(detail.database.docCount)} />
            <StatPill label="Size" value={formatBytes(detail.database.sizeBytes)} />
            <StatPill label="Indexes" value={String(detail.database.indexCount)} />
          </div>
        ) : null}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search collections…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
          {filtered && detail ? (
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground ml-auto">
              {filtered.length === detail.collections.length
                ? `${detail.collections.length} total`
                : `${filtered.length} of ${detail.collections.length}`}
            </span>
          ) : null}
        </div>

        {detail === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {detail.collections.length === 0
              ? "No collections in this database."
              : "No collections match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Collection"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <SortableTh
                    label="Docs"
                    keyName="docs"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[100px]"
                  />
                  <SortableTh
                    label="Storage"
                    keyName="size"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[32%]"
                  />
                  <SortableTh
                    label="Avg doc"
                    keyName="avg"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[100px]"
                  />
                  <SortableTh
                    label="Indexes"
                    keyName="indexes"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[90px]"
                  />
                </tr>
              </thead>
              <tbody>
                {filtered!.map((c) => {
                  const pct =
                    maxSize > 0
                      ? Math.min(100, (c.storageBytes / maxSize) * 100)
                      : 0;
                  return (
                    <tr
                      key={c.name}
                      className="border-t border-border/40 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs truncate">
                            {c.name}
                          </span>
                          <TypePill type={c.type} />
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
                        {formatCompact(c.docCount)}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs tabular-nums w-20 text-right text-muted-foreground">
                            {formatBytes(c.storageBytes)}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                c.storageBytes === 0
                                  ? "bg-muted"
                                  : "bg-gradient-to-r from-emerald-500/70 to-green-500/70"
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums text-muted-foreground">
                        {c.avgDocSize > 0 ? formatBytes(c.avgDocSize) : "—"}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
                        {c.indexCount}
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

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground normal-case tracking-normal">{value}</span>
    </span>
  );
}

function TypePill({ type }: { type: CollectionSummary["type"] }) {
  if (type === "collection") return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[9px] font-mono uppercase tracking-wider border-border/60",
        type === "view" && "text-blue-600 dark:text-blue-400 border-blue-500/40",
        type === "timeSeries" &&
          "text-purple-600 dark:text-purple-400 border-purple-500/40"
      )}
    >
      {type === "timeSeries" ? "time-series" : type}
    </Badge>
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
