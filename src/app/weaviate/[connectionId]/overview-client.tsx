"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Boxes,
  Database,
  Layers,
  Package,
  RefreshCcw,
  Server,
  Tag,
  Zap,
} from "lucide-react";

interface CollectionSummary {
  name: string;
  description?: string;
  objectCount: number;
  vectorizer: string;
  propertyCount: number;
}

interface Overview {
  url: string;
  version?: string;
  hostname?: string;
  moduleCount: number;
  modules: string[];
  collectionCount: number;
  totalObjects: number;
  partial: boolean;
  collections: CollectionSummary[];
  topCollectionsByObjects: { name: string; objects: number }[];
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
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/weaviate/${connectionId}/overview`, {
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
          ? `${overview.collectionCount} collection${overview.collectionCount === 1 ? "" : "s"} · ${formatCompact(overview.totalObjects)} objects${overview.version ? ` · v${overview.version}` : ""}`
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

          {overview.partial ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Some object counts are unavailable — Weaviate&apos;s aggregate API
              (gRPC) didn&apos;t respond for one or more collections. Check
              that port 50051 is reachable on the server.
            </div>
          ) : null}

          {/* ── Cluster strip ───────────────────────────────────────────── */}
          <ClusterStrip
            url={overview.url}
            collectionCount={overview.collectionCount}
            version={overview.version}
            hostname={overview.hostname}
          />

          {/* ── Big stats ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Layers className="size-3.5" />}
              label="Collections"
              value={overview.collectionCount}
              href={`/weaviate/${connectionId}/collections`}
            />
            <StatTile
              icon={<Boxes className="size-3.5" />}
              label="Objects"
              value={overview.totalObjects}
              valueCompact
              sub={overview.partial ? "partial — gRPC issues" : "sum across all"}
            />
            <StatTile
              icon={<Package className="size-3.5" />}
              label="Modules"
              value={overview.moduleCount}
              sub={
                overview.modules.length > 0
                  ? truncate(overview.modules.join(" · "), 36)
                  : "no extension modules"
              }
            />
            <StatTile
              icon={<Tag className="size-3.5" />}
              label="Version"
              value={0}
              valueDisplay={overview.version ?? "—"}
              sub={overview.hostname ?? undefined}
            />
          </div>

          {/* ── Top collections ─────────────────────────────────────────── */}
          <TopCollectionsCard
            collections={overview.topCollectionsByObjects}
            totalObjects={overview.totalObjects}
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
  version,
  hostname,
}: {
  url: string;
  collectionCount: number;
  version?: string;
  hostname?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-green-500/10 via-teal-500/5 to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Server className="size-4 text-green-500" />
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
                {version ? (
                  <>
                    {" · "}
                    <span className="font-mono">v{version}</span>
                  </>
                ) : null}
              </span>
            </p>
          </div>
        </div>
        {hostname ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <Database className="size-3" />
            {hostname}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  valueCompact,
  valueDisplay,
  sub,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  valueCompact?: boolean;
  valueDisplay?: string;
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
        <span className="text-3xl font-semibold tabular-nums tracking-tight truncate">
          {valueDisplay ?? (valueCompact ? formatCompact(value) : fmt.format(value))}
        </span>
      </div>
      {sub ? (
        <p className="mt-1 text-xs text-muted-foreground truncate">{sub}</p>
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

function TopCollectionsCard({
  collections,
  totalObjects,
  connectionId,
}: {
  collections: { name: string; objects: number }[];
  totalObjects: number;
  connectionId: string;
}) {
  const max = collections[0]?.objects ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="size-4 text-green-500" />
          Top collections by object count
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          top 5
        </span>
      </div>
      {collections.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No collections with available counts.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {collections.map((c) => {
            const pct = max > 0 ? Math.max(2, (c.objects / max) * 100) : 0;
            const share =
              totalObjects > 0 ? (c.objects / totalObjects) * 100 : 0;
            return (
              <Link
                key={c.name}
                href={`/weaviate/${connectionId}/collections/${encodeURIComponent(c.name)}`}
                className="block group"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate group-hover:text-foreground text-foreground/80">
                    {c.name}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(c.objects)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-green-500 to-teal-500 transition-all"
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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
