"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/components/workspace/format";
import {
  Activity,
  ArrowUpRight,
  Inbox,
  Network,
  RefreshCcw,
  Send,
  Server,
  Users,
  Zap,
} from "lucide-react";

interface NodeInfo {
  name: string;
  running: boolean;
  type?: string;
  memUsed?: number;
  diskFree?: number;
  diskFreeLimit?: number;
  fdUsed?: number;
  fdTotal?: number;
}

interface Overview {
  rabbitVersion?: string;
  erlangVersion?: string;
  clusterName?: string;
  totalMessages: number;
  messagesReady: number;
  messagesUnacknowledged: number;
  totalQueues: number;
  totalConsumers: number;
  totalChannels: number;
  totalConnections: number;
  totalExchanges: number;
  publishRate: number;
  deliverRate: number;
  ackRate: number;
  nodes: NodeInfo[];
  topQueues: {
    name: string;
    vhost: string;
    messages: number;
    state: string;
  }[];
}

const fmt = new Intl.NumberFormat("en-US");

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function formatRate(r: number): string {
  if (r === 0) return "0";
  if (r < 1) return r.toFixed(2);
  if (r < 10) return r.toFixed(1);
  return formatCompact(Math.round(r));
}

interface Props {
  connectionId: string;
}

export function OverviewClient({ connectionId }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rabbit/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setOverview(data as Overview);
      else {
        setError(data.error || "Could not load broker overview");
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
      title="Broker"
      description={
        overview
          ? `${overview.nodes.length} node${overview.nodes.length === 1 ? "" : "s"}${overview.rabbitVersion ? ` · RabbitMQ ${overview.rabbitVersion}` : ""}${overview.clusterName ? ` · ${overview.clusterName}` : ""}`
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

          <ClusterStrip overview={overview} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Zap className="size-3.5" />}
              label="Total messages"
              value={overview.totalMessages}
              valueCompact
              sub={`${formatCompact(overview.messagesReady)} ready · ${formatCompact(overview.messagesUnacknowledged)} unacked`}
            />
            <StatTile
              icon={<Inbox className="size-3.5" />}
              label="Queues"
              value={overview.totalQueues}
              sub={`${overview.totalExchanges} exchanges`}
              href={`/rabbit/${connectionId}/queues`}
            />
            <StatTile
              icon={<Users className="size-3.5" />}
              label="Consumers"
              value={overview.totalConsumers}
              sub={`${overview.totalChannels} channels`}
            />
            <StatTile
              icon={<Network className="size-3.5" />}
              label="Connections"
              value={overview.totalConnections}
              sub={`${formatRate(overview.publishRate)} pub/s · ${formatRate(overview.deliverRate)} del/s`}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <RateCard overview={overview} />
            <TopQueuesCard
              queues={overview.topQueues}
              totalMessages={overview.totalMessages}
              connectionId={connectionId}
            />
          </div>

          <NodesCard nodes={overview.nodes} />
        </div>
      )}
    </WorkspacePage>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function ClusterStrip({ overview }: { overview: Overview }) {
  const running = overview.nodes.filter((n) => n.running).length;
  const total = overview.nodes.length;
  const allUp = total > 0 && running === total;
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-amber-500/5 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Server className="size-4 text-amber-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Cluster status
            </p>
            <p className="text-sm font-semibold">
              {total === 0
                ? "no nodes reported"
                : `${running} of ${total} node${total === 1 ? "" : "s"} running`}
              {overview.erlangVersion ? (
                <span className="text-muted-foreground font-normal">
                  {" · "}Erlang{" "}
                  <span className="font-mono text-foreground">
                    {overview.erlangVersion}
                  </span>
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {overview.nodes.map((n) => (
            <span
              key={n.name}
              title={`${n.name}${n.running ? " (running)" : " (down)"}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono",
                "border bg-background/40 hover:bg-background transition-colors",
                n.running
                  ? "border-emerald-500/30 text-foreground/80"
                  : "border-rose-500/40 text-rose-700 dark:text-rose-300"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  n.running
                    ? allUp
                      ? "bg-emerald-500"
                      : "bg-emerald-500 status-pulse"
                    : "bg-rose-500"
                )}
              />
              {shortNodeName(n.name)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function shortNodeName(name: string): string {
  // "rabbit@hostname" → "hostname"
  const at = name.indexOf("@");
  return at >= 0 ? name.slice(at + 1) : name;
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
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </>
  );

  const base = cn(
    "rounded-lg border border-border/60 p-4 bg-card transition-colors hover:bg-muted/30",
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

function RateCard({ overview }: { overview: Overview }) {
  const maxRate = Math.max(
    1,
    overview.publishRate,
    overview.deliverRate,
    overview.ackRate
  );
  const rows = [
    {
      label: "Publish",
      icon: <Send className="size-3.5 text-amber-500" />,
      rate: overview.publishRate,
      color: "from-amber-500/70 to-orange-500/70",
    },
    {
      label: "Deliver",
      icon: <ArrowUpRight className="size-3.5 text-sky-500" />,
      rate: overview.deliverRate,
      color: "from-sky-500/70 to-cyan-500/70",
    },
    {
      label: "Ack",
      icon: <Activity className="size-3.5 text-emerald-500" />,
      rate: overview.ackRate,
      color: "from-emerald-500/70 to-green-500/70",
    },
  ];
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="size-4 text-amber-500" />
          Message rates
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          msg/s
        </span>
      </div>
      <div className="p-4 space-y-3">
        {rows.map((r) => {
          const pct = Math.max(0, Math.min(100, (r.rate / maxRate) * 100));
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  {r.icon}
                  {r.label}
                </span>
                <span className="tabular-nums font-mono text-foreground">
                  {formatRate(r.rate)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full bg-gradient-to-r transition-all",
                    r.color
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopQueuesCard({
  queues,
  totalMessages,
  connectionId,
}: {
  queues: Overview["topQueues"];
  totalMessages: number;
  connectionId: string;
}) {
  const max = queues[0]?.messages ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="size-4 text-amber-500" />
          Top queues by depth
        </h3>
        <Link
          href={`/rabbit/${connectionId}/queues`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open ›
        </Link>
      </div>
      {queues.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No queues in this vhost.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {queues.map((q) => {
            const pct =
              max > 0 ? Math.max(2, (q.messages / max) * 100) : 0;
            const share =
              totalMessages > 0 ? (q.messages / totalMessages) * 100 : 0;
            return (
              <div key={`${q.vhost}/${q.name}`} className="block">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate text-foreground/80">
                    {q.name}
                    {q.vhost && q.vhost !== "/" ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {q.vhost}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(q.messages)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500/70 to-orange-500/70 transition-all"
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

function NodesCard({ nodes }: { nodes: NodeInfo[] }) {
  if (nodes.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Server className="size-4" />
          Nodes
        </h3>
      </div>
      <div className="divide-y divide-border/40">
        {nodes.map((n) => {
          const diskCritical =
            typeof n.diskFree === "number" &&
            typeof n.diskFreeLimit === "number" &&
            n.diskFree < n.diskFreeLimit;
          return (
            <div
              key={n.name}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    n.running ? "bg-emerald-500" : "bg-rose-500"
                  )}
                />
                <span className="font-mono truncate">{n.name}</span>
                {n.type ? (
                  <Badge
                    variant="secondary"
                    className="text-[9px] font-mono uppercase tracking-wider"
                  >
                    {n.type}
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-4 text-muted-foreground font-mono tabular-nums">
                {typeof n.memUsed === "number" ? (
                  <span title="Memory used">{formatBytes(n.memUsed)}</span>
                ) : null}
                {typeof n.fdUsed === "number" && typeof n.fdTotal === "number" ? (
                  <span title="File descriptors used/total">
                    {n.fdUsed}/{n.fdTotal} fd
                  </span>
                ) : null}
                {typeof n.diskFree === "number" ? (
                  <span
                    title="Free disk"
                    className={cn(
                      diskCritical && "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {formatBytes(n.diskFree)} free
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
