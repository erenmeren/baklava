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
  RefreshCcw,
  Activity,
  AlertTriangle,
  Boxes,
  Cpu,
  Layers,
  Server,
  HardDrive,
} from "lucide-react";

interface Overview {
  context: string;
  cluster: string;
  apiServer: string;
  nodes: {
    name: string;
    ready: boolean;
    roles: string[];
    kubeletVersion: string;
    osImage: string;
    architecture: string;
    cpuCapacity: string;
    memoryCapacity: string;
    creationTimestamp: string | null;
  }[];
  namespaceCount: number;
  podCount: number;
  podPhases: Record<string, number>;
  topNamespacesByPods: { name: string; pods: number }[];
}

interface Props {
  connectionId: string;
}

const fmt = new Intl.NumberFormat("en-US");

function formatMemory(quantity: string): string {
  // Kubernetes memory quantities come as e.g. "16384000Ki" or "8Gi"
  const match = quantity.match(/^(\d+(?:\.\d+)?)([KMGTPE]i?)?$/);
  if (!match) return quantity;
  const n = Number(match[1]);
  const unit = match[2] ?? "";
  const factors: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 * 1024,
    Gi: 1024 * 1024 * 1024,
    Ti: 1024 * 1024 * 1024 * 1024,
    K: 1000,
    M: 1_000_000,
    G: 1_000_000_000,
    T: 1_000_000_000_000,
  };
  const bytes = n * (factors[unit] ?? 1);
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  return `${(bytes / 1024 ** 4).toFixed(1)}TB`;
}

const PHASE_TONES: Record<string, string> = {
  Running: "bg-emerald-500",
  Pending: "bg-amber-500",
  Succeeded: "bg-sky-500",
  Failed: "bg-red-500",
  Unknown: "bg-muted",
};

export function OverviewClient({ connectionId }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/kubernetes/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setOverview(data as Overview);
      else {
        setError(data.error || "Could not load cluster");
        toast.error("Could not load", { description: data.error });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          ? `${overview.context} · ${overview.nodes.length} node${overview.nodes.length === 1 ? "" : "s"} · ${overview.namespaceCount} namespace${overview.namespaceCount === 1 ? "" : "s"}`
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

          {/* Cluster strip */}
          <div className="rounded-lg border border-border/60 bg-gradient-to-r from-blue-500/5 via-transparent to-transparent p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
                  <Server className="size-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    API server
                  </p>
                  <p className="text-sm font-semibold font-mono">
                    {overview.apiServer}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {overview.nodes.map((n) => (
                  <span
                    key={n.name}
                    title={`${n.name} · ${n.roles.join(",")} · ${n.kubeletVersion}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono border bg-background/40 hover:bg-background transition-colors",
                      n.roles.includes("control-plane") ||
                        n.roles.includes("master")
                        ? "border-blue-500/50 text-blue-700 dark:text-blue-300"
                        : "border-border/60 text-foreground/80"
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        n.ready
                          ? n.roles.includes("control-plane")
                            ? "bg-blue-500 status-pulse"
                            : "bg-emerald-500"
                          : "bg-red-500"
                      )}
                    />
                    {n.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Server className="size-3.5" />}
              label="Nodes"
              value={overview.nodes.length}
              sub={`${overview.nodes.filter((n) => n.ready).length} ready`}
              tone={
                overview.nodes.some((n) => !n.ready) ? "warn" : "default"
              }
            />
            <StatTile
              icon={<Layers className="size-3.5" />}
              label="Namespaces"
              value={overview.namespaceCount}
            />
            <StatTile
              icon={<Boxes className="size-3.5" />}
              label="Pods"
              value={overview.podCount}
              sub={Object.entries(overview.podPhases)
                .map(([p, n]) => `${n} ${p.toLowerCase()}`)
                .join(" · ")}
              href={`/kubernetes/${connectionId}/pods`}
            />
            <StatTile
              icon={<Activity className="size-3.5" />}
              label="Running"
              value={overview.podPhases.Running ?? 0}
              sub={
                overview.podCount > 0
                  ? `${Math.round(((overview.podPhases.Running ?? 0) / overview.podCount) * 100)}% of pods`
                  : undefined
              }
            />
          </div>

          {/* Phase distribution bar */}
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Boxes className="size-4 text-blue-500" />
                Pod phase distribution
              </h3>
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {overview.podCount} total
              </span>
            </div>
            {overview.podCount === 0 ? (
              <p className="text-xs text-muted-foreground">No pods scheduled.</p>
            ) : (
              <>
                <div className="flex h-2 rounded-full overflow-hidden border border-border/60">
                  {Object.entries(overview.podPhases).map(([phase, count]) => {
                    const pct = (count / overview.podCount) * 100;
                    return (
                      <div
                        key={phase}
                        className={cn(
                          "h-full",
                          PHASE_TONES[phase] ?? "bg-muted"
                        )}
                        style={{ width: `${pct}%` }}
                        title={`${phase} · ${count}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {Object.entries(overview.podPhases).map(([phase, count]) => (
                    <span key={phase} className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          PHASE_TONES[phase] ?? "bg-muted"
                        )}
                      />
                      {phase} · {count}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Two-column grid: nodes + top namespaces */}
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  {overview.nodes.every((n) => n.ready) ? (
                    <Activity className="size-4 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="size-4 text-amber-500" />
                  )}
                  Nodes
                </h3>
                <Badge
                  variant="secondary"
                  className={
                    overview.nodes.every((n) => n.ready)
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40"
                  }
                >
                  {overview.nodes.every((n) => n.ready) ? "all ready" : "degraded"}
                </Badge>
              </div>
              <div className="divide-y divide-border/40">
                {overview.nodes.map((n) => (
                  <div key={n.name} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            "size-2 rounded-full shrink-0",
                            n.ready ? "bg-emerald-500" : "bg-red-500"
                          )}
                        />
                        <span className="font-mono text-xs truncate">
                          {n.name}
                        </span>
                        {n.roles.map((r) => (
                          <Badge
                            key={r}
                            variant="outline"
                            className="text-[9px] font-mono uppercase tracking-wider"
                          >
                            {r}
                          </Badge>
                        ))}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {n.kubeletVersion}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground pl-4">
                      <span className="flex items-center gap-1">
                        <Cpu className="size-3" />
                        {n.cpuCapacity} cores
                      </span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="size-3" />
                        {formatMemory(n.memoryCapacity)}
                      </span>
                      <span className="truncate">{n.osImage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="size-4 text-blue-500" />
                  Top namespaces by pods
                </h3>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  top {overview.topNamespacesByPods.length}
                </span>
              </div>
              {overview.topNamespacesByPods.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No pods scheduled.
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {overview.topNamespacesByPods.map((ns) => {
                    const max = overview.topNamespacesByPods[0]?.pods ?? 1;
                    const pct = Math.max(2, (ns.pods / max) * 100);
                    return (
                      <Link
                        key={ns.name}
                        href={`/kubernetes/${connectionId}/pods?ns=${encodeURIComponent(ns.name)}`}
                        className="block group"
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-mono truncate text-foreground/80 group-hover:text-foreground">
                            {ns.name}
                          </span>
                          <span className="tabular-nums font-mono text-muted-foreground">
                            {fmt.format(ns.pods)} pods
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </WorkspacePage>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
  tone = "default",
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
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
          {fmt.format(value)}
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
