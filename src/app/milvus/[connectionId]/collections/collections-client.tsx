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
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

interface CollectionStat {
  name: string;
  id: string;
  rowCount: number;
  loaded: boolean;
  loadState: string;
  description: string;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "rows";
type SortDir = "asc" | "desc";

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

export function CollectionsClient({ connectionId }: Props) {
  const [collections, setCollections] = useState<CollectionStat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [loadedFilter, setLoadedFilter] = useState<"all" | "loaded" | "unloaded">(
    "all"
  );
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "rows",
    dir: "desc",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/milvus/${connectionId}/collections`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setCollections(data.collections as CollectionStat[]);
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
    if (loadedFilter === "loaded") out = out.filter((c) => c.loaded);
    if (loadedFilter === "unloaded") out = out.filter((c) => !c.loaded);
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      return (a.rowCount - b.rowCount) * mult;
    });
    return out;
  }, [collections, search, loadedFilter, sort]);

  const maxRows = useMemo(
    () => collections?.reduce((m, c) => Math.max(m, c.rowCount), 0) ?? 0,
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
            ? `${collections.length} collection${collections.length === 1 ? "" : "s"} · ${formatCompact(collections.reduce((s, c) => s + c.rowCount, 0))} rows`
            : `${filtered.length} of ${collections.length}`
          : undefined
      }
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            <RefreshCcw
              className={cn("size-3.5", loading && "animate-spin")}
            />
            Refresh
          </Button>
        </>
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
          <Segmented
            value={loadedFilter}
            onChange={setLoadedFilter}
            options={[
              { value: "all", label: "All" },
              { value: "loaded", label: "Loaded" },
              { value: "unloaded", label: "Unloaded" },
            ]}
          />
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
              ? "No collections yet. Create one with the Milvus client to get started."
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
                  <th className="px-3 py-2 text-left w-[20%]">ID</th>
                  <SortableTh
                    label="Rows"
                    keyName="rows"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[28%]"
                  />
                  <th className="px-3 py-2 text-left w-[110px]">Status</th>
                  <th className="px-3 py-2 text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {filtered!.map((c) => (
                  <CollectionRow
                    key={c.name}
                    collection={c}
                    connectionId={connectionId}
                    maxRows={maxRows}
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
  maxRows,
}: {
  collection: CollectionStat;
  connectionId: string;
  maxRows: number;
}) {
  const pct =
    maxRows > 0 ? Math.min(100, (collection.rowCount / maxRows) * 100) : 0;
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30 group">
      <td className="px-3 py-2 align-middle">
        <Link
          href={`/milvus/${connectionId}/collections/${encodeURIComponent(collection.name)}`}
          className="font-mono text-xs hover:underline truncate inline-block max-w-[40ch]"
        >
          {collection.name}
        </Link>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground truncate max-w-[16ch]">
        {collection.id || "—"}
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums w-14 text-right text-muted-foreground">
            {formatCompact(collection.rowCount)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                collection.rowCount === 0
                  ? "bg-muted"
                  : "bg-gradient-to-r from-indigo-500/70 to-purple-500/70"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        {collection.loaded ? (
          <Badge
            variant="secondary"
            className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[9px] font-mono uppercase tracking-wider"
          >
            <span className="size-1 rounded-full bg-emerald-500 mr-1" />
            loaded
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-border/60"
            title={collection.loadState}
          >
            <span className="size-1 rounded-full bg-muted-foreground/60 mr-1" />
            unloaded
          </Badge>
        )}
      </td>
      <td className="px-3 py-2 align-middle text-xs text-muted-foreground truncate max-w-[40ch]">
        {collection.description || (
          <span className="text-muted-foreground/50">—</span>
        )}
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

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 rounded-[5px] transition-colors",
            value === o.value
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
