"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Loader2, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CollectionSummary } from "@/lib/connections/qdrant";

interface Props {
  connectionId: string;
}

export function QdrantSidebar({ connectionId }: Props) {
  const pathname = usePathname();
  const abortRef = useRef<AbortController | null>(null);
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const res = await fetch(`/api/qdrant/${connectionId}/collections`, {
        cache: "no-store",
        signal: ac.signal,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { collections: CollectionSummary[] };
      setCollections(data.collections);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Abort on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const base = `/qdrant/${connectionId}`;

  return (
    <div className="space-y-1 select-none">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Database className="size-3" />
          Collections
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => setRefreshKey((n) => n + 1)}
          title="Refresh"
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCcw className="size-3" />
          )}
        </Button>
      </div>

      {collections === null ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
      ) : collections.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          (no collections)
        </div>
      ) : (
        <ul>
          {collections.map((c) => {
            const href = `${base}/collections/${encodeURIComponent(c.name)}`;
            const active = pathname?.startsWith(href) ?? false;
            return (
              <li key={c.name}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono transition-colors",
                    active
                      ? "bg-foreground/10 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                  )}
                >
                  <Database className="size-3 shrink-0" />
                  <span className="truncate">{c.name}</span>
                  {c.pointsCount > 0 ? (
                    <span className="ml-auto text-[10px] tabular-nums shrink-0 text-muted-foreground/70">
                      {c.pointsCount.toLocaleString()}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
