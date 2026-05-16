"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Activity,
  Database,
  Layers,
  RefreshCcw,
  Server,
  Zap,
} from "lucide-react";

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

interface Overview {
  url: string;
  collectionCount: number;
  totalVectors: number;
  totalPoints: number;
  totalSegments: number;
  status: string;
  collections: CollectionSummary[];
  topCollectionsByVectors: { name: string; vectors: number }[];
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

function statusTone(status: string): "ok" | "warn" | "error" | "unknown" {
  const s = status.toLowerCase();
  if (s === "green") return "ok";
  if (s === "yellow" || s === "grey") return "warn";
  if (s === "red") return "error";
  return "unknown";
}

export function OverviewClient({ connectionId }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/qdrant/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setOverview(data as Overview);
      else {
        setError(data.error || "Could not load cluster overview");
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
      title="Cluster"
      description={
        overview
          ? `${overview.collectionCount} collection${overview.collectionCount === 1 ? "" : "s"} · ${formatCompact(overview.totalVectors)} indexed vectors`
          : undefined
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
      {overview === null ? (
        <div className="space-y-4">
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

          {/* ── Cluster strip ───────────────────────────────────────────── */}
          <ClusterStrip
            url={overview.url}
            collectionCount={overview.collectionCount}
            status={overview.status}
          />

          {/* ── Big stats ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Layers className="size-3.5" />}
              label="Collections"
              value={overview.collectionCount}
              href={`/qdrant/${connectionId}/collections`}
            />
            <StatTile
              icon={<Zap className="size-3.5" />}
              label="Vectors"
              value={overview.totalVectors}
              valueCompact
              sub="sum of indexed"
            />
            <StatTile
              icon={<Database className="size-3.5" />}
              label="Points"
              value={overview.totalPoints}
              valueCompact
              sub={`${formatCompact(overview.totalSegments)} segments`}
            />
            <StatusTile status={overview.status} />
          </div>

          {/* ── Top collections ─────────────────────────────────────────── */}
          <TopCollectionsCard
            collections={overview.topCollectionsByVectors}
            totalVectors={overview.totalVectors}
            connectionId={connectionId}
          />
        </div>
      )}
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ClusterStrip({
  url,
  collectionCount,
  status,
}: {
  url: string;
  collectionCount: number;
  status: string;
}) {
  const tone = statusTone(status);
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-red-500/10 via-pink-500/5 to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Server className="size-4 text-red-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Cluster
            </p>
            <p className="text-sm font-semibold truncate">
              <span className="font-mono text-foreground">{url}</span>
              <span className="text-muted-foreground font-normal">
                {" · "}
                {collectionCount} collection
                {collectionCount === 1 ? "" : "s"}
              </span>
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider",
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
              "size-1.5 rounded-full",
              tone === "ok" && "bg-emerald-500 status-pulse",
              tone === "warn" && "bg-amber-500",
              tone === "error" && "bg-red-500 status-pulse",
              tone === "unknown" && "bg-muted-foreground"
            )}
          />
          {status}
        </span>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  valueCompact,
  sub,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  valueCompact?: boolean;
  sub?: string;
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
        <span className="text-3xl font-semibold tabular-nums tracking-tight">
          {valueCompact ? formatCompact(value) : fmt.format(value)}
        </span>
      </div>
      {sub ? (
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </>
  );

  const base = cn(
    "rounded-lg border p-4 bg-card transition-colors border-border/60 hover:bg-muted/30",
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

function StatusTile({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <div
      className={cn(
        "rounded-lg border p-4 bg-card transition-colors",
        tone === "ok" && "border-emerald-500/40 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/40 bg-amber-500/5",
        tone === "error" && "border-red-500/40 bg-red-500/5",
        tone === "unknown" && "border-border/60"
      )}
    >
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] flex items-center gap-1.5">
          <Activity className="size-3.5" />
          Status
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "text-3xl font-semibold tabular-nums tracking-tight capitalize",
            tone === "ok" && "text-emerald-600 dark:text-emerald-400",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
            tone === "error" && "text-red-600 dark:text-red-400"
          )}
        >
          {status}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        worst-of across collections
      </p>
    </div>
  );
}

function TopCollectionsCard({
  collections,
  totalVectors,
  connectionId,
}: {
  collections: { name: string; vectors: number }[];
  totalVectors: number;
  connectionId: string;
}) {
  const max = collections[0]?.vectors ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="size-4 text-red-500" />
          Top collections by indexed vectors
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
            const pct = max > 0 ? Math.max(2, (c.vectors / max) * 100) : 0;
            const share =
              totalVectors > 0 ? (c.vectors / totalVectors) * 100 : 0;
            return (
              <Link
                key={c.name}
                href={`/qdrant/${connectionId}/collections/${encodeURIComponent(c.name)}`}
                className="block group"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate group-hover:text-foreground text-foreground/80">
                    {c.name}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(c.vectors)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-red-500 to-pink-500 transition-all"
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
