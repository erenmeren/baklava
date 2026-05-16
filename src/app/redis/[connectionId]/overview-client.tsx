"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  Key,
  Database,
  HardDrive,
  Users,
  Zap,
  ServerCog,
} from "lucide-react";

interface KeyspaceEntry {
  db: number;
  keys: number;
  expires: number;
  avgTtl: number;
}

interface Overview {
  version: string;
  mode: string;
  os: string;
  role: string;
  uptimeSeconds: number;
  connectedClients: number;
  blockedClients: number;
  usedMemory: number;
  usedMemoryHuman: string;
  maxMemory: number;
  maxMemoryHuman: string;
  totalCommandsProcessed: number;
  instantaneousOpsPerSec: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRatio: number | null;
  totalKeys: number;
  keyspace: KeyspaceEntry[];
  replication: {
    role: string;
    connectedReplicas: number;
    masterHost?: string;
    masterPort?: number;
    masterLinkStatus?: string;
  };
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

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

export function OverviewClient({ connectionId }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculated commands/sec from delta — INFO already gives the instantaneous
  // value but we also track our own as a smoothed fallback.
  const lastRef = useRef<{ commands: number; at: number } | null>(null);
  const [opsPerSec, setOpsPerSec] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/redis/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        const next = data as Overview;
        const now = Date.now();
        if (lastRef.current) {
          const dt = (now - lastRef.current.at) / 1000;
          const dc = next.totalCommandsProcessed - lastRef.current.commands;
          if (dt > 0 && dc >= 0) {
            setOpsPerSec(Math.round(dc / dt));
          }
        }
        lastRef.current = { commands: next.totalCommandsProcessed, at: now };
        setOverview(next);
      } else {
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

  const displayOps =
    opsPerSec ?? overview?.instantaneousOpsPerSec ?? null;

  return (
    <WorkspacePage
      title="Server"
      description={
        overview
          ? `Redis ${overview.version} · ${overview.role} · uptime ${formatUptime(overview.uptimeSeconds)}`
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
          <Skeleton className="h-20 w-full" />
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

          <RolePulseStrip overview={overview} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Key className="size-3.5" />}
              label="Keys"
              value={overview.totalKeys}
              valueCompact
              sub={`${overview.keyspace.length} db${overview.keyspace.length === 1 ? "" : "s"} populated`}
              href={`/redis/${connectionId}/keys`}
            />
            <StatTile
              icon={<HardDrive className="size-3.5" />}
              label="Memory"
              value={overview.usedMemoryHuman}
              raw
              sub={
                overview.maxMemory > 0
                  ? `of ${overview.maxMemoryHuman}`
                  : "no maxmemory cap"
              }
            />
            <StatTile
              icon={<Users className="size-3.5" />}
              label="Clients"
              value={overview.connectedClients}
              sub={
                overview.blockedClients > 0
                  ? `${overview.blockedClients} blocked`
                  : "all active"
              }
            />
            <StatTile
              icon={<Zap className="size-3.5" />}
              label="Commands/sec"
              value={displayOps ?? 0}
              sub={`${formatCompact(overview.totalCommandsProcessed)} total`}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <KeyspaceCard
              keyspace={overview.keyspace}
              totalKeys={overview.totalKeys}
            />
            <CacheStatsCard overview={overview} />
          </div>

          <ServerInfoCard overview={overview} />
        </div>
      )}
    </WorkspacePage>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function RolePulseStrip({ overview }: { overview: Overview }) {
  const isReplica = overview.role === "slave" || overview.role === "replica";
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-rose-500/5 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <ServerCog className="size-4 text-rose-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Replication
            </p>
            <p className="text-sm font-semibold capitalize">
              {overview.role}
              {isReplica && overview.replication.masterHost ? (
                <span className="text-muted-foreground font-normal">
                  {" of "}
                  <span className="font-mono text-foreground">
                    {overview.replication.masterHost}:
                    {overview.replication.masterPort ?? ""}
                  </span>
                </span>
              ) : null}
              {!isReplica ? (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  <span className="font-mono text-foreground">
                    {overview.replication.connectedReplicas}
                  </span>{" "}
                  replica{overview.replication.connectedReplicas === 1 ? "" : "s"}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono",
              "border bg-background/40",
              "border-rose-500/50 text-rose-700 dark:text-rose-300"
            )}
            title={`mode: ${overview.mode}`}
          >
            <span className="size-1.5 rounded-full bg-rose-500 status-pulse" />
            {overview.mode}
          </span>
          {isReplica ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono border",
                overview.replication.masterLinkStatus === "up"
                  ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 text-amber-700 dark:text-amber-300"
              )}
            >
              link {overview.replication.masterLinkStatus ?? "?"}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  raw,
  valueCompact,
  sub,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  raw?: boolean;
  valueCompact?: boolean;
  sub?: string;
  href?: string;
}) {
  const display = raw
    ? value
    : valueCompact
      ? formatCompact(Number(value))
      : fmt.format(Number(value));
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
          {display}
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

function KeyspaceCard({
  keyspace,
  totalKeys,
}: {
  keyspace: KeyspaceEntry[];
  totalKeys: number;
}) {
  const max = keyspace.reduce((m, k) => Math.max(m, k.keys), 0);
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="size-4 text-rose-500" />
          Keyspace
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {totalKeys === 0
            ? "empty"
            : `${formatCompact(totalKeys)} key${totalKeys === 1 ? "" : "s"}`}
        </span>
      </div>
      {keyspace.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No databases contain keys.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {keyspace.map((db) => {
            const pct = max > 0 ? Math.max(2, (db.keys / max) * 100) : 0;
            return (
              <div key={db.db}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono text-foreground/80">
                    db{db.db}
                    {db.expires > 0 ? (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        · {fmt.format(db.expires)} with ttl
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(db.keys)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rose-500 to-red-500 transition-all"
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

function CacheStatsCard({ overview }: { overview: Overview }) {
  const ratio = overview.hitRatio;
  const pct = ratio == null ? 0 : Math.round(ratio * 100);
  const tone =
    ratio == null
      ? "neutral"
      : ratio >= 0.9
        ? "good"
        : ratio >= 0.5
          ? "okay"
          : "bad";
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="size-4 text-rose-500" />
          Cache stats
        </h3>
        {ratio !== null ? (
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] font-mono uppercase tracking-wider",
              tone === "good" &&
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
              tone === "okay" &&
                "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
              tone === "bad" &&
                "bg-destructive/10 text-destructive border-destructive/30"
            )}
          >
            {pct}% hit
          </Badge>
        ) : null}
      </div>
      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Hit ratio</span>
            <span className="tabular-nums font-mono">
              {ratio == null ? "—" : `${pct}%`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                tone === "good" && "bg-emerald-500",
                tone === "okay" && "bg-amber-500",
                tone === "bad" && "bg-destructive",
                tone === "neutral" && "bg-muted-foreground/40"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Hits
            </p>
            <p className="text-sm font-mono tabular-nums mt-0.5">
              {formatCompact(overview.keyspaceHits)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Misses
            </p>
            <p className="text-sm font-mono tabular-nums mt-0.5">
              {formatCompact(overview.keyspaceMisses)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ServerInfoCard({ overview }: { overview: Overview }) {
  const rows = [
    ["Version", overview.version],
    ["Mode", overview.mode],
    ["OS", overview.os],
    ["Uptime", formatUptime(overview.uptimeSeconds)],
    ["Connected clients", fmt.format(overview.connectedClients)],
    ["Blocked clients", fmt.format(overview.blockedClients)],
    ["Used memory", overview.usedMemoryHuman],
    [
      "Max memory",
      overview.maxMemory > 0 ? overview.maxMemoryHuman : "unbounded",
    ],
    [
      "Commands processed",
      fmt.format(overview.totalCommandsProcessed),
    ],
    [
      "Ops/sec (instantaneous)",
      fmt.format(overview.instantaneousOpsPerSec),
    ],
  ];
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ServerCog className="size-4" />
          Server info
        </h3>
      </div>
      <div className="divide-y divide-border/40">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-center justify-between gap-3 px-4 py-2 text-xs"
          >
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
