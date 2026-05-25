"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  AutoRefresh,
  DEFAULT_REFRESH_INTERVALS,
} from "@/components/workspace/auto-refresh";
import { ClusterPulse } from "./cluster-pulse";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  Database,
  Network,
  Server,
  Users,
  Zap,
} from "lucide-react";

interface BrokerInfo {
  nodeId: number;
  host: string;
  port: number;
  isController: boolean;
}

interface Summary {
  brokers: BrokerInfo[];
  controllerId: number | null;
  userTopicCount: number;
  internalTopicCount: number;
  totalPartitions: number;
  underReplicatedPartitions: number;
  underReplicatedTopics: string[];
  offlinePartitions: number;
  consumerGroupCount: number;
  groupStates: Record<string, number>;
  totalMessages: number;
  topTopicsByVolume: { name: string; messages: number }[];
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
      const res = await fetch(`/api/kafka/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setSummary(data as Summary);
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


  return (
    <WorkspacePage
      title="Cluster"
      description={
        summary
          ? `${summary.brokers.length} broker${summary.brokers.length === 1 ? "" : "s"} · controller ${summary.controllerId ?? "—"}`
          : undefined
      }
      actions={
        <>
          <AutoRefresh
            intervalMs={15_000}
            intervals={DEFAULT_REFRESH_INTERVALS}
            onTick={load}
            loading={loading}
          />
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

          {/* ── Cluster pulse — 5-min rolling health, lost on refresh ─── */}
          <ClusterPulse connectionId={connectionId} />

          {/* ── Broker pulse strip ────────────────────────────────────────── */}
          <BrokerStrip
            brokers={summary.brokers}
            controllerId={summary.controllerId}
          />

          {/* ── Big stats ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Network className="size-3.5" />}
              label="Topics"
              value={summary.userTopicCount}
              sub={`+ ${summary.internalTopicCount} internal`}
              href={`/kafka/${connectionId}/topics`}
            />
            <StatTile
              icon={<Database className="size-3.5" />}
              label="Partitions"
              value={summary.totalPartitions}
              sub={
                summary.underReplicatedPartitions > 0
                  ? `${summary.underReplicatedPartitions} under-replicated`
                  : "all in-sync"
              }
              tone={
                summary.underReplicatedPartitions > 0 ? "warn" : "default"
              }
            />
            <StatTile
              icon={<Zap className="size-3.5" />}
              label="Messages"
              value={summary.totalMessages}
              valueCompact
              sub="across user + internal"
            />
            <StatTile
              icon={<Users className="size-3.5" />}
              label="Consumer groups"
              value={summary.consumerGroupCount}
              sub={describeStates(summary.groupStates)}
              href={`/kafka/${connectionId}/consumer-groups`}
            />
          </div>

          {/* ── Two-column section: health + leaderboard ──────────────────── */}
          <div className="grid lg:grid-cols-2 gap-3">
            <HealthCard
              underReplicatedPartitions={summary.underReplicatedPartitions}
              underReplicatedTopics={summary.underReplicatedTopics}
              connectionId={connectionId}
            />
            <TopTopicsCard
              topics={summary.topTopicsByVolume}
              totalMessages={summary.totalMessages}
              connectionId={connectionId}
            />
          </div>

          {/* ── Brokers table ─────────────────────────────────────────────── */}
          <BrokersCard
            brokers={summary.brokers}
            connectionId={connectionId}
          />
        </div>
      )}
    </WorkspacePage>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function BrokerStrip({
  brokers,
  controllerId,
}: {
  brokers: BrokerInfo[];
  controllerId: number | null;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-orange-500/5 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Server className="size-4 text-orange-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Cluster status
            </p>
            <p className="text-sm font-semibold">
              {brokers.length} broker{brokers.length === 1 ? "" : "s"} online
              {controllerId != null ? (
                <span className="text-muted-foreground font-normal">
                  {" · "}controller{" "}
                  <span className="font-mono text-foreground">{controllerId}</span>
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {brokers.map((b) => (
            <span
              key={b.nodeId}
              title={`Node ${b.nodeId} — ${b.host}:${b.port}${b.isController ? " (controller)" : ""}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono",
                "border bg-background/40 hover:bg-background transition-colors",
                b.isController
                  ? "border-orange-500/50 text-orange-700 dark:text-orange-300"
                  : "border-border/60 text-foreground/80"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  b.isController
                    ? "bg-orange-500 status-pulse"
                    : "bg-emerald-500"
                )}
              />
              {b.nodeId}
            </span>
          ))}
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
  sub,
  tone = "default",
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  valueCompact?: boolean;
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
          {valueCompact ? formatCompact(value) : fmt.format(value)}
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

function HealthCard({
  underReplicatedPartitions,
  underReplicatedTopics,
  connectionId,
}: {
  underReplicatedPartitions: number;
  underReplicatedTopics: string[];
  connectionId: string;
}) {
  const healthy = underReplicatedPartitions === 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {healthy ? (
            <Activity className="size-4 text-emerald-500" />
          ) : (
            <AlertTriangle className="size-4 text-amber-500" />
          )}
          <h3 className="text-sm font-semibold">Replication health</h3>
        </div>
        <Badge
          variant={healthy ? "secondary" : "default"}
          className={
            healthy
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40"
          }
        >
          {healthy ? "healthy" : "degraded"}
        </Badge>
      </div>
      {healthy ? (
        <div className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            All partitions are in-sync.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Every replica matches its assigned ISR set.
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            {underReplicatedPartitions} partition
            {underReplicatedPartitions === 1 ? "" : "s"} across{" "}
            {underReplicatedTopics.length} topic
            {underReplicatedTopics.length === 1 ? "" : "s"} have missing ISR
            replicas.
          </p>
          <ul className="space-y-1 max-h-48 overflow-auto">
            {underReplicatedTopics.map((t) => (
              <li key={t}>
                <Link
                  href={`/kafka/${connectionId}/topics/${encodeURIComponent(t)}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-xs hover:bg-amber-500/10"
                >
                  <span className="font-mono truncate">{t}</span>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    URP
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TopTopicsCard({
  topics,
  totalMessages,
  connectionId,
}: {
  topics: { name: string; messages: number }[];
  totalMessages: number;
  connectionId: string;
}) {
  const max = topics[0]?.messages ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="size-4 text-orange-500" />
          Top topics by volume
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          top 5
        </span>
      </div>
      {topics.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No user topics with messages.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {topics.map((t) => {
            const pct = max > 0 ? Math.max(2, (t.messages / max) * 100) : 0;
            const share =
              totalMessages > 0
                ? (t.messages / totalMessages) * 100
                : 0;
            return (
              <Link
                key={t.name}
                href={`/kafka/${connectionId}/topics/${encodeURIComponent(t.name)}`}
                className="block group"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate group-hover:text-foreground text-foreground/80">
                    {t.name}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(t.messages)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-500 transition-all"
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

function BrokersCard({
  brokers,
  connectionId,
}: {
  brokers: BrokerInfo[];
  connectionId: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Server className="size-4" />
          Brokers
        </h3>
        <Link
          href={`/kafka/${connectionId}/brokers`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open ›
        </Link>
      </div>
      <div className="divide-y divide-border/40">
        {brokers.map((b) => (
          <div
            key={b.nodeId}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "size-2 rounded-full",
                  b.isController ? "bg-orange-500 status-pulse" : "bg-emerald-500"
                )}
              />
              <span className="font-mono text-xs">
                <span className="text-muted-foreground">node </span>
                <span className="text-foreground">{b.nodeId}</span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {b.host}:{b.port}
              </span>
            </div>
            {b.isController ? (
              <Badge
                variant="secondary"
                className="bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30 text-[10px] font-mono uppercase tracking-wider"
              >
                controller
              </Badge>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function describeStates(states: Record<string, number>): string | undefined {
  const entries = Object.entries(states);
  if (entries.length === 0) return "no active members";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
    .join(" · ");
}
