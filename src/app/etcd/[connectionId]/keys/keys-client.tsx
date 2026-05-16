"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCcw, Search } from "lucide-react";

interface KeyEntry {
  key: string;
  createRevision: string;
  modRevision: string;
  version: string;
  valueSize: number;
}

interface KeysResponse {
  keys: KeyEntry[];
  total: number;
  limit: number;
  prefix: string;
}

interface Props {
  connectionId: string;
}

const PAGE_SIZE = 100;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function KeysClient({ connectionId }: Props) {
  const [prefix, setPrefix] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [keys, setKeys] = useState<KeyEntry[] | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [limit, setLimit] = useState<number>(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextLimit: number, p: string, isReset: boolean) => {
      if (isReset) {
        setLoading(true);
        setKeys(null);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams();
        if (p) params.set("prefix", p);
        params.set("limit", String(nextLimit));
        const res = await fetch(
          `/api/etcd/${connectionId}/keys?${params.toString()}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Could not load keys");
          toast.error("Could not load", { description: data.error });
          if (isReset) setKeys([]);
          return;
        }
        const next = data as KeysResponse;
        setKeys(next.keys);
        setTotal(next.total);
        setLimit(next.limit);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        if (isReset) setKeys([]);
      } finally {
        if (isReset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    load(PAGE_SIZE, "", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const p = searchInput.trim();
    setPrefix(p);
    load(PAGE_SIZE, p, true);
  };

  const refresh = () => {
    load(limit, prefix, true);
  };

  const loadMore = () => {
    load(limit + PAGE_SIZE, prefix, false);
  };

  const hasMore = keys !== null && keys.length < total;

  return (
    <WorkspacePage
      title="Keys"
      description={
        keys
          ? `${keys.length} of ${total} loaded${prefix ? ` · prefix ${prefix}` : ""}`
          : undefined
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={loading || loadingMore}
        >
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <form
          onSubmit={submitSearch}
          className="flex items-center gap-2 flex-wrap"
        >
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Prefix (e.g. /config/ or leave empty for all)"
              className="h-8 pl-8 text-xs font-mono"
              spellCheck={false}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            range · prefix
          </span>
        </form>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {keys === null ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {prefix ? (
              <>
                No keys under prefix{" "}
                <span className="font-mono">{prefix}</span>.
              </>
            ) : (
              "No keys in the keyspace."
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Key</th>
                  <th className="px-3 py-2 text-left w-[80px]">Type</th>
                  <th className="px-3 py-2 text-left w-[120px]">Mod rev</th>
                  <th className="px-3 py-2 text-right w-[100px]">Size</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <KeyRow key={k.key} entry={k} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore ? (
          <div className="flex justify-center py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Load more
            </Button>
          </div>
        ) : keys && keys.length > 0 ? (
          <div className="text-center text-[11px] font-mono uppercase tracking-wider text-muted-foreground py-3">
            all keys loaded
          </div>
        ) : null}
      </div>
    </WorkspacePage>
  );
}

function KeyRow({ entry }: { entry: KeyEntry }) {
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-1.5 align-middle min-w-0">
        <span
          className="font-mono text-xs truncate block max-w-[420px]"
          title={entry.key}
        >
          {entry.key}
        </span>
      </td>
      <td className="px-3 py-1.5 align-middle">
        <Badge
          variant="secondary"
          className={cn(
            "text-[9px] font-mono uppercase tracking-wider border",
            "bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30"
          )}
        >
          kv
        </Badge>
      </td>
      <td className="px-3 py-1.5 align-middle">
        <span
          className="font-mono text-[11px] text-muted-foreground"
          title={`create ${entry.createRevision} · version ${entry.version}`}
        >
          {entry.modRevision}
        </span>
      </td>
      <td className="px-3 py-1.5 align-middle text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatBytes(entry.valueSize)}
      </td>
    </tr>
  );
}
