"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Activity,
  Boxes,
  Database,
  HeartPulse,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

interface CollectionStat {
  name: string;
  id: string;
  count: number;
  metadataKeys: string[];
  configHint: string;
}

interface Summary {
  url: string;
  tenant: string;
  database: string;
  version: string;
  heartbeatNs: number;
  heartbeatOk: boolean;
  collectionCount: number;
  totalDocuments: number;
  topCollections: { name: string; count: number }[];
  collections: CollectionStat[];
}

interface Props {
  connectionId: string;
}

const fmt = new Intl.NumberFormat("en-US");

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

export function OverviewClient({ connectionId }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chroma/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setSummary(data as Summary);
      else {
        setError(data.error || "Could not load overview");
        toast.error("Could not load", { description: data.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <WorkspacePage
      title="Server"
      description={
        summary ? `Chroma ${summary.version} · ${summary.url}` : undefined
      }
      actions={
        <>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500 status-pulse" />
            auto · 15s
          </span>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCcw
              className={cn("size-3.5", loading && "animate-spin")}
            />
            Refresh
          </Button>
        </>
      }
    >
      {summary === null ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="space-y-6">
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <ServerStrip summary={summary} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Boxes className="size-3.5" />}
              label="Collections"
              value={summary.collectionCount}
              href={`/chroma/${connectionId}/collections`}
            />
            <StatTile
              icon={<Database className="size-3.5" />}
              label="Documents"
              value={summary.totalDocuments}
              valueCompact
              sub="across all collections"
            />
            <StatTile
              icon={<Sparkles className="size-3.5" />}
              label="Version"
              value={0}
              valueOverride={summary.version}
              sub="server build"
            />
            <StatTile
              icon={<HeartPulse className="size-3.5" />}
              label="Heartbeat"
              value={0}
              valueOverride={summary.heartbeatOk ? "ok" : "down"}
              sub={
                summary.heartbeatOk
                  ? "responding"
                  : "did not respond to heartbeat"
              }
              tone={summary.heartbeatOk ? "default" : "warn"}
            />
          </div>

          <TopCollectionsCard
            collections={summary.topCollections}
            connectionId={connectionId}
          />
        </div>
      )}
    </WorkspacePage>
  );
}

function ServerStrip({ summary }: { summary: Summary }) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-pink-500/5 via-rose-500/5 to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Activity className="size-4 text-pink-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Embedding store
            </p>
            <p className="text-sm font-semibold">
              <span className="font-mono">{summary.url}</span>
              <span className="text-muted-foreground font-normal">
                {" · "}
                <span className="font-mono text-foreground">
                  {summary.tenant}/{summary.database}
                </span>
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] font-mono uppercase tracking-wider",
              summary.heartbeatOk
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full mr-1",
                summary.heartbeatOk
                  ? "bg-emerald-500 status-pulse"
                  : "bg-amber-500"
              )}
            />
            {summary.heartbeatOk ? "online" : "no heartbeat"}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  valueCompact,
  valueOverride,
  sub,
  tone = "default",
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  valueCompact?: boolean;
  valueOverride?: string;
  sub?: string;
  tone?: "default" | "warn";
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] flex items-center gap-1.5">
          {icon}
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "text-3xl font-semibold tabular-nums tracking-tight",
            tone === "warn" && "text-amber-600 dark:text-amber-400"
          )}
        >
          {valueOverride ?? (valueCompact ? formatCompact(value) : fmt.format(value))}
        </span>
      </div>
      {sub ? (
        <p
          className={cn(
            "mt-1 text-xs",
            tone === "warn"
              ? "text-amber-700/80 dark:text-amber-300/80"
              : "text-muted-foreground"
          )}
        >
          {sub}
        </p>
      ) : null}
    </>
  );

  const base = cn(
    "rounded-lg border p-4 bg-card transition-colors",
    tone === "warn"
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-border/60 hover:bg-muted/30",
    href && "cursor-pointer hover:border-foreground/30"
  );

  return href ? (
    <Link href={href} className={base}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}

function TopCollectionsCard({
  collections,
  connectionId,
}: {
  collections: { name: string; count: number }[];
  connectionId: string;
}) {
  const max = collections[0]?.count ?? 0;
  const total = collections.reduce((s, c) => s + c.count, 0);
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="size-4 text-pink-500" />
          Top collections by documents
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          top 5
        </span>
      </div>
      {collections.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No collections yet.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {collections.map((c) => {
            const pct = max > 0 ? Math.max(2, (c.count / max) * 100) : 0;
            const share = total > 0 ? (c.count / total) * 100 : 0;
            return (
              <Link
                key={c.name}
                href={`/chroma/${connectionId}/collections/${encodeURIComponent(c.name)}`}
                className="block group"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate group-hover:text-foreground text-foreground/80">
                    {c.name}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(c.count)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pink-500 to-rose-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
