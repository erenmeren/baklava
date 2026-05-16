"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

interface VectorParamSummary {
  name: string;
  size: number;
  distance: string;
}

interface CollectionSummary {
  name: string;
  vectorsCount: number;
  pointsCount: number;
  segmentsCount: number;
  status: string;
  optimizerStatus: string;
  vectorSize: number;
  distance: string;
  vectors: VectorParamSummary[];
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "vectors" | "points" | "segments";
type SortDir = "asc" | "desc";

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

const DISTANCE_TONES: Record<string, string> = {
  Cosine:
    "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Dot: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Euclid:
    "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Manhattan:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function CollectionsClient({ connectionId }: Props) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "vectors",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/qdrant/${connectionId}/collections`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setCollections(data.collections as CollectionSummary[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!collections) return null;
    const q = search.trim().toLowerCase();
    let out = collections;
    if (q) out = out.filter((c) => c.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "vectors")
        return (a.vectorsCount - b.vectorsCount) * mult;
      if (sort.key === "points")
        return (a.pointsCount - b.pointsCount) * mult;
      return (a.segmentsCount - b.segmentsCount) * mult;
    });
    return out;
  }, [collections, search, sort]);

  const maxVectors = useMemo(
    () => collections?.reduce((m, c) => Math.max(m, c.vectorsCount), 0) ?? 0,
    [collections]
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
      title="Collections"
      description={
        filtered && collections
          ? filtered.length === collections.length
            ? `${collections.length} collection${collections.length === 1 ? "" : "s"} · ${formatCompact(collections.reduce((s, c) => s + c.vectorsCount, 0))} vectors`
            : `${filtered.length} of ${collections.length}`
          : undefined
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={load}
          disabled={loading}
        >
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
              placeholder="Search collections…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
        </div>

        {collections === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {collections.length === 0
              ? "No collections yet. Create one with the Qdrant API or CLI to get started."
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
                    label="Vectors"
                    keyName="vectors"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[26%]"
                  />
                  <SortableTh
                    label="Points"
                    keyName="points"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[90px]"
                  />
                  <SortableTh
                    label="Seg"
                    keyName="segments"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[60px]"
                  />
                  <th className="px-3 py-2 text-left w-[100px]">Distance</th>
                  <th className="px-3 py-2 text-left w-[60px]">Dim</th>
                  <th className="px-3 py-2 text-left w-[80px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered!.map((c) => (
                  <CollectionRow
                    key={c.name}
                    collection={c}
                    connectionId={connectionId}
                    maxVectors={maxVectors}
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

function CollectionRow({
  collection,
  connectionId,
  maxVectors,
}: {
  collection: CollectionSummary;
  connectionId: string;
  maxVectors: number;
}) {
  const pct =
    maxVectors > 0
      ? Math.min(100, (collection.vectorsCount / maxVectors) * 100)
      : 0;
  const tone = statusTone(collection.status);
  const distanceTone =
    DISTANCE_TONES[collection.distance] ??
    "border-border/60 bg-muted/40 text-muted-foreground";
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <Link
          href={`/qdrant/${connectionId}/collections/${encodeURIComponent(collection.name)}`}
          className="font-mono text-xs hover:underline"
        >
          {collection.name}
        </Link>
        {collection.vectors.length > 1 ? (
          <span className="ml-2 inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            {collection.vectors.length} named
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums w-14 text-right text-muted-foreground">
            {formatCompact(collection.vectorsCount)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-500/70 to-pink-500/70 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {formatCompact(collection.pointsCount)}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {collection.segmentsCount}
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-mono",
            distanceTone
          )}
        >
          {collection.distance}
        </span>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums text-muted-foreground">
        {collection.vectorSize || "—"}
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
            tone === "ok" &&
              "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            tone === "warn" &&
              "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            tone === "error" &&
              "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
            tone === "unknown" &&
              "border-border/60 bg-muted/40 text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "size-1 rounded-full",
              tone === "ok" && "bg-emerald-500",
              tone === "warn" && "bg-amber-500",
              tone === "error" && "bg-red-500",
              tone === "unknown" && "bg-muted-foreground"
            )}
          />
          {collection.status}
        </span>
      </td>
    </tr>
  );
}

function statusTone(status: string): "ok" | "warn" | "error" | "unknown" {
  const s = status.toLowerCase();
  if (s === "green") return "ok";
  if (s === "yellow" || s === "grey") return "warn";
  if (s === "red") return "error";
  return "unknown";
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
