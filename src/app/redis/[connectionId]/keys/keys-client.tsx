"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCcw, Search, Clock, Infinity as InfIcon } from "lucide-react";

// URLs over this length tend to be rejected by Next dev or fronting proxies.
// Show a non-clickable row for those rather than a 404.
const MAX_KEY_URL_LEN = 1500;

interface KeyEntry {
  key: string;
  type: string;
  ttl: number;
  memoryBytes: number | null;
}

interface KeysResponse {
  keys: KeyEntry[];
  nextCursor: string;
  scanned: number;
}

interface Props {
  connectionId: string;
}

const TYPE_TONE: Record<string, string> = {
  string: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  list: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  hash: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  set: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  zset: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  stream: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTtl(seconds: number): { label: string; tone: "none" | "soon" | "ok" } {
  if (seconds === -2) return { label: "expired", tone: "soon" };
  if (seconds === -1) return { label: "no ttl", tone: "none" };
  if (seconds < 60) return { label: `${seconds}s`, tone: "soon" };
  if (seconds < 3600) return { label: `${Math.floor(seconds / 60)}m`, tone: "ok" };
  if (seconds < 86400) return { label: `${Math.floor(seconds / 3600)}h`, tone: "ok" };
  return { label: `${Math.floor(seconds / 86400)}d`, tone: "ok" };
}

export function KeysClient({ connectionId }: Props) {
  const [pattern, setPattern] = useState("*");
  const [searchInput, setSearchInput] = useState("*");
  const [keys, setKeys] = useState<KeyEntry[] | null>(null);
  const [cursor, setCursor] = useState<string>("0");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (resetCursor: boolean, p: string) => {
      const isReset = resetCursor;
      if (isReset) {
        setLoading(true);
        setKeys(null);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("pattern", p || "*");
        params.set("count", "100");
        params.set("cursor", isReset ? "0" : cursor);
        const res = await fetch(
          `/api/redis/${connectionId}/keys?${params.toString()}`,
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
        setCursor(next.nextCursor);
        setDone(next.nextCursor === "0");
        setKeys((prev) => {
          if (isReset || prev === null) return next.keys;
          return [...prev, ...next.keys];
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        if (isReset) setKeys([]);
      } finally {
        if (isReset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [connectionId, cursor]
  );

  useEffect(() => {
    load(true, "*");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const p = searchInput.trim() || "*";
    setPattern(p);
    setCursor("0");
    setDone(false);
    load(true, p);
  };

  const refresh = () => {
    setCursor("0");
    setDone(false);
    load(true, pattern);
  };

  return (
    <WorkspacePage
      title="Keys"
      description={
        keys
          ? `${keys.length} loaded${done ? " (complete)" : " · paginated"}${pattern !== "*" ? ` · pattern ${pattern}` : ""}`
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
              placeholder="Glob pattern (e.g. user:* or *)"
              className="h-8 pl-8 text-xs font-mono"
              spellCheck={false}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            scan · safe
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
            No keys match{" "}
            <span className="font-mono">{pattern}</span>.
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Key</th>
                  <th className="px-3 py-2 text-left w-[80px]">Type</th>
                  <th className="px-3 py-2 text-left w-[100px]">TTL</th>
                  <th className="px-3 py-2 text-right w-[100px]">Memory</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k, i) => (
                  <KeyRow
                    key={`${k.key}-${i}`}
                    entry={k}
                    connectionId={connectionId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {keys && keys.length > 0 && !done ? (
          <div className="flex justify-center py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(false, pattern)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Load more
            </Button>
          </div>
        ) : null}
        {keys && keys.length > 0 && done ? (
          <div className="text-center text-[11px] font-mono uppercase tracking-wider text-muted-foreground py-3">
            scan complete
          </div>
        ) : null}
      </div>
    </WorkspacePage>
  );
}

function KeyRow({
  entry,
  connectionId,
}: {
  entry: KeyEntry;
  connectionId: string;
}) {
  const ttl = formatTtl(entry.ttl);
  const typeClass =
    TYPE_TONE[entry.type] ??
    "bg-muted text-muted-foreground border-border/60";
  const encoded = encodeURIComponent(entry.key);
  const tooLong = encoded.length > MAX_KEY_URL_LEN;
  const href = `/redis/${connectionId}/keys/${encoded}`;
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-1.5 align-middle min-w-0">
        {tooLong ? (
          <span
            className="font-mono text-xs truncate block max-w-[420px] text-destructive cursor-not-allowed"
            title={`${entry.key}\n\nKey too long to open in a URL (${encoded.length} chars).`}
          >
            {entry.key}
          </span>
        ) : (
          <Link
            href={href}
            className="font-mono text-xs truncate block max-w-[420px] hover:text-primary hover:underline underline-offset-2"
            title={entry.key}
          >
            {entry.key}
          </Link>
        )}
      </td>
      <td className="px-3 py-1.5 align-middle">
        <Badge
          variant="secondary"
          className={cn(
            "text-[9px] font-mono uppercase tracking-wider border",
            typeClass
          )}
        >
          {entry.type}
        </Badge>
      </td>
      <td className="px-3 py-1.5 align-middle">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-mono",
            ttl.tone === "soon"
              ? "text-amber-700 dark:text-amber-300"
              : ttl.tone === "none"
                ? "text-muted-foreground"
                : "text-foreground/80"
          )}
        >
          {ttl.tone === "none" ? (
            <InfIcon className="size-3" />
          ) : (
            <Clock className="size-3" />
          )}
          {ttl.label}
        </span>
      </td>
      <td className="px-3 py-1.5 align-middle text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatBytes(entry.memoryBytes)}
      </td>
    </tr>
  );
}
