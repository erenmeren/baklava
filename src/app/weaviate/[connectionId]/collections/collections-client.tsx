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

interface CollectionSummary {
  name: string;
  description?: string;
  objectCount: number;
  vectorizer: string;
  propertyCount: number;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "objects" | "properties";
type SortDir = "asc" | "desc";

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function vectorizerTone(vectorizer: string): string {
  const v = vectorizer.toLowerCase();
  if (v === "none")
    return "border-border/60 bg-muted/40 text-muted-foreground";
  if (v.includes("openai"))
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (v.includes("cohere"))
    return "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300";
  if (v.includes("huggingface"))
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (v.includes("transformers"))
    return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300";
}

export function CollectionsClient({ connectionId }: Props) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "objects",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/weaviate/${connectionId}/collections`, {
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
    if (q)
      out = out.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description ?? "").toLowerCase().includes(q)
      );
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "properties")
        return (a.propertyCount - b.propertyCount) * mult;
      // objects: treat -1 (unavailable) as 0 for ordering
      const av = a.objectCount < 0 ? 0 : a.objectCount;
      const bv = b.objectCount < 0 ? 0 : b.objectCount;
      return (av - bv) * mult;
    });
    return out;
  }, [collections, search, sort]);

  const maxObjects = useMemo(
    () =>
      collections?.reduce(
        (m, c) => Math.max(m, c.objectCount < 0 ? 0 : c.objectCount),
        0
      ) ?? 0,
    [collections]
  );

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  const totalObjects = useMemo(
    () =>
      collections
        ?.filter((c) => c.objectCount >= 0)
        .reduce((s, c) => s + c.objectCount, 0) ?? 0,
    [collections]
  );

  return (
    <WorkspacePage
      title="Collections"
      description={
        filtered && collections
          ? filtered.length === collections.length
            ? `${collections.length} collection${collections.length === 1 ? "" : "s"} · ${formatCompact(totalObjects)} objects`
            : `${filtered.length} of ${collections.length}`
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
              ? "No collections yet. Create one with the Weaviate client or REST API."
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
                  <th className="px-3 py-2 text-left w-[28%]">Description</th>
                  <SortableTh
                    label="Objects"
                    keyName="objects"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[24%]"
                  />
                  <th className="px-3 py-2 text-left w-[140px]">Vectorizer</th>
                  <SortableTh
                    label="Props"
                    keyName="properties"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[60px]"
                  />
                </tr>
              </thead>
              <tbody>
                {filtered!.map((c) => (
                  <CollectionRow
                    key={c.name}
                    collection={c}
                    connectionId={connectionId}
                    maxObjects={maxObjects}
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
  maxObjects,
}: {
  collection: CollectionSummary;
  connectionId: string;
  maxObjects: number;
}) {
  const unavailable = collection.objectCount < 0;
  const safeCount = unavailable ? 0 : collection.objectCount;
  const pct =
    maxObjects > 0 ? Math.min(100, (safeCount / maxObjects) * 100) : 0;
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <Link
          href={`/weaviate/${connectionId}/collections/${encodeURIComponent(collection.name)}`}
          className="font-mono text-xs hover:underline"
        >
          {collection.name}
        </Link>
      </td>
      <td className="px-3 py-2 align-middle text-xs text-muted-foreground truncate max-w-[28ch]">
        {collection.description?.trim() || (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums w-14 text-right text-muted-foreground">
            {unavailable ? "—" : formatCompact(collection.objectCount)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                unavailable
                  ? "bg-muted"
                  : "bg-gradient-to-r from-green-500/70 to-teal-500/70"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-mono",
            vectorizerTone(collection.vectorizer)
          )}
          title={collection.vectorizer}
        >
          {collection.vectorizer}
        </span>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {collection.propertyCount}
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
