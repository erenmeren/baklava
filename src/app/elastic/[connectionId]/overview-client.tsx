"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { formatBytes } from "@/components/workspace/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  RefreshCcw,
  Search,
  Server,
  FileText,
  HardDrive,
  Cpu,
} from "lucide-react";

interface TopIndex {
  name: string;
  docCount: number;
  storeSize: number;
}

interface Overview {
  version: string;
  clusterName: string;
  nodeName: string;
  status: "green" | "yellow" | "red" | "unknown";
  nodeCount: number;
  totalIndices: number;
  totalDocs: number;
  totalStoreBytes: number;
  jvmHeapUsedBytes: number;
  jvmHeapMaxBytes: number;
  topIndicesByDocs: TopIndex[];
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

const STATUS_COLOR: Record<Overview["status"], string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  unknown: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<Overview["status"], string> = {
  green: "green",
  yellow: "yellow",
  red: "red",
  unknown: "unknown",
};

export function OverviewClient({ connectionId }: Props) {
  const [summary, setSummary] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/elastic/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setSummary(data as Overview);
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
        summary
          ? `${summary.clusterName || "—"} · node ${summary.nodeName || "—"} · v${summary.version}`
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
      {summary === null ? (
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

          {/* ── Cluster health pulse strip ─────────────────────────────────── */}
          <HealthStrip
            status={summary.status}
            clusterName={summary.clusterName}
            nodeCount={summary.nodeCount}
            version={summary.version}
          />

          {/* ── Big stats ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Server className="size-3.5" />}
              label="Nodes"
              value={summary.nodeCount}
            />
            <StatTile
              icon={<Search className="size-3.5" />}
              label="Indices"
              value={summary.totalIndices}
              href={`/elastic/${connectionId}/indices`}
            />
            <StatTile
              icon={<FileText className="size-3.5" />}
              label="Documents"
              value={summary.totalDocs}
              valueCompact
            />
            <StatTile
              icon={<HardDrive className="size-3.5" />}
              label="Store"
              valueText={formatBytes(summary.totalStoreBytes)}
            />
          </div>

          {/* ── JVM heap + Top indices ────────────────────────────────────── */}
          <div className="grid lg:grid-cols-2 gap-3">
            <JvmHeapCard
              used={summary.jvmHeapUsedBytes}
              max={summary.jvmHeapMaxBytes}
            />
            <TopIndicesCard
              indices={summary.topIndicesByDocs}
              totalDocs={summary.totalDocs}
              connectionId={connectionId}
            />
          </div>
        </div>
      )}
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function HealthStrip({
  status,
  clusterName,
  nodeCount,
  version,
}: {
  status: Overview["status"];
  clusterName: string;
  nodeCount: number;
  version: string;
}) {
  const gradient =
    status === "green"
      ? "from-emerald-500/10"
      : status === "yellow"
        ? "from-amber-500/10"
        : status === "red"
          ? "from-red-500/10"
          : "from-muted/30";
  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-gradient-to-r via-transparent to-transparent p-4",
        gradient
      )}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Search className="size-4 text-teal-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Cluster health
            </p>
            <p className="text-sm font-semibold">
              {clusterName || "—"}
              <span className="text-muted-foreground font-normal">
                {" · "}
                {nodeCount} node{nodeCount === 1 ? "" : "s"}
                {" · "}v{version}
              </span>
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-mono uppercase tracking-wider border",
            status === "green" &&
              "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            status === "yellow" &&
              "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            status === "red" &&
              "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
            status === "unknown" && "border-border/60 text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              STATUS_COLOR[status],
              status !== "unknown" && "status-pulse"
            )}
          />
          {STATUS_LABEL[status]}
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
  valueText,
  sub,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueCompact?: boolean;
  valueText?: string;
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
          {valueText ??
            (valueCompact
              ? formatCompact(value ?? 0)
              : fmt.format(value ?? 0))}
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

function JvmHeapCard({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const tone =
    pct >= 90 ? "red" : pct >= 75 ? "amber" : "emerald";
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Cpu className="size-4 text-teal-500" />
          JVM heap
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          across all nodes
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">
            {formatBytes(used)}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            of {formatBytes(max)} · {pct.toFixed(0)}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              tone === "red" && "bg-red-500",
              tone === "amber" && "bg-amber-500",
              tone === "emerald" &&
                "bg-gradient-to-r from-teal-500 to-cyan-500"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {tone === "red"
            ? "Heap pressure critical — investigate GC time and consider scaling."
            : tone === "amber"
              ? "Heap usage elevated."
              : "Healthy heap usage."}
        </p>
      </div>
    </div>
  );
}

function TopIndicesCard({
  indices,
  totalDocs,
  connectionId,
}: {
  indices: TopIndex[];
  totalDocs: number;
  connectionId: string;
}) {
  const max = indices[0]?.docCount ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="size-4 text-teal-500" />
          Top indices by docs
        </h3>
        <Link
          href={`/elastic/${connectionId}/indices`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open ›
        </Link>
      </div>
      {indices.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No indices yet.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {indices.map((idx) => {
            const pct = max > 0 ? Math.max(2, (idx.docCount / max) * 100) : 0;
            const share =
              totalDocs > 0 ? (idx.docCount / totalDocs) * 100 : 0;
            return (
              <div key={idx.name} className="block">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate text-foreground/80">
                    {idx.name}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(idx.docCount)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
