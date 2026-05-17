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
  Database,
  HardDrive,
  Layers,
  Network,
  RefreshCcw,
  Server,
  Users,
  Zap,
} from "lucide-react";

interface Overview {
  serverName?: string;
  serverId?: string;
  serverVersion?: string;
  host?: string;
  port?: number;
  cluster?: string;
  protoVersion?: number;
  maxPayload?: number;
  jetstreamEnabled: boolean;
  clientId?: number;
  connectUrls: string[];
  account: {
    enabled: boolean;
    memory: number;
    storage: number;
    streams: number;
    consumers: number;
    apiTotal?: number;
    apiErrors?: number;
    domain?: string;
    limits?: {
      maxMemory: number;
      maxStorage: number;
      maxStreams: number;
      maxConsumers: number;
    };
  };
  topStreams: {
    name: string;
    messages: number;
    bytes: number;
    consumers: number;
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
      const res = await fetch(`/api/nats/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setOverview(data as Overview);
      else {
        setError(data.error || "Could not load server overview");
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
        overview
          ? `${overview.serverName ?? "nats"}${overview.serverVersion ? ` · v${overview.serverVersion}` : ""}${overview.cluster ? ` · cluster ${overview.cluster}` : ""}`
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

          <ServerStrip overview={overview} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Layers className="size-3.5" />}
              label="Streams"
              value={overview.account.streams}
              sub={
                overview.jetstreamEnabled
                  ? overview.account.enabled
                    ? `${overview.account.consumers} consumer${overview.account.consumers === 1 ? "" : "s"}`
                    : "account info unavailable"
                  : "JetStream disabled"
              }
              tone={overview.jetstreamEnabled ? "default" : "warn"}
              href={`/nats/${connectionId}/streams`}
            />
            <StatTile
              icon={<Zap className="size-3.5" />}
              label="Messages stored"
              value={overview.account.streams === 0 ? 0 : sumTop(overview.topStreams)}
              valueCompact
              sub="across known streams"
            />
            <StatTile
              icon={<HardDrive className="size-3.5" />}
              label="Storage"
              valueRaw={formatBytes(overview.account.storage)}
              sub={
                overview.account.memory > 0
                  ? `+ ${formatBytes(overview.account.memory)} memory`
                  : "file backed"
              }
            />
            <StatTile
              icon={<Users className="size-3.5" />}
              label="Consumers"
              value={overview.account.consumers}
              sub={
                overview.account.apiTotal != null
                  ? `${formatCompact(overview.account.apiTotal)} api · ${overview.account.apiErrors ?? 0} err`
                  : undefined
              }
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <AccountCard overview={overview} />
            <TopStreamsCard
              streams={overview.topStreams}
              connectionId={connectionId}
              jetstreamEnabled={overview.jetstreamEnabled}
            />
          </div>

          <ServerCard overview={overview} />
        </div>
      )}
    </WorkspacePage>
  );
}

function sumTop(rows: { messages: number }[]): number {
  return rows.reduce((s, r) => s + r.messages, 0);
}

// ──────────────────────────────────────────────────────────────────────────────

function ServerStrip({ overview }: { overview: Overview }) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-sky-500/5 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Server className="size-4 text-sky-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Server
            </p>
            <p className="text-sm font-semibold">
              {overview.serverName ?? "nats"}
              {overview.host && overview.port ? (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  <span className="font-mono text-foreground">
                    {overview.host}:{overview.port}
                  </span>
                </span>
              ) : null}
              {overview.cluster ? (
                <span className="text-muted-foreground font-normal">
                  {" · cluster "}
                  <span className="font-mono text-foreground">
                    {overview.cluster}
                  </span>
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className={cn(
              "text-[9px] font-mono uppercase tracking-wider border",
              overview.jetstreamEnabled
                ? "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30"
                : "bg-muted text-muted-foreground border-border/60"
            )}
          >
            <span
              className={cn(
                "size-1 rounded-full mr-1",
                overview.jetstreamEnabled
                  ? "bg-sky-500 status-pulse"
                  : "bg-muted-foreground"
              )}
            />
            jetstream {overview.jetstreamEnabled ? "on" : "off"}
          </Badge>
          {overview.serverVersion ? (
            <Badge
              variant="secondary"
              className="text-[9px] font-mono uppercase tracking-wider border border-border/60"
            >
              v{overview.serverVersion}
            </Badge>
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
  valueRaw,
  valueCompact,
  sub,
  tone = "default",
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueRaw?: string;
  valueCompact?: boolean;
  sub?: string;
  tone?: "default" | "warn";
  href?: string;
}) {
  const display =
    valueRaw ?? (valueCompact ? formatCompact(value ?? 0) : fmt.format(value ?? 0));
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
          {display}
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

function AccountCard({ overview }: { overview: Overview }) {
  const a = overview.account;
  if (!overview.jetstreamEnabled) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        <div className="px-4 py-3 border-b border-amber-500/20 flex items-center gap-2">
          <Database className="size-4 text-amber-500" />
          <h3 className="text-sm font-semibold">JetStream</h3>
        </div>
        <div className="p-6 text-center text-sm text-muted-foreground">
          JetStream is not enabled on this server. Start nats-server with{" "}
          <span className="font-mono text-foreground">-js</span> to unlock
          streams, consumers and KV.
        </div>
      </div>
    );
  }
  const limits = a.limits;
  const rows = [
    {
      label: "Memory",
      used: a.memory,
      limit: limits?.maxMemory ?? -1,
    },
    {
      label: "Storage",
      used: a.storage,
      limit: limits?.maxStorage ?? -1,
    },
  ];
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="size-4 text-sky-500" />
          JetStream account
        </h3>
        {a.domain ? (
          <Badge
            variant="secondary"
            className="text-[9px] font-mono uppercase tracking-wider border border-border/60"
          >
            domain {a.domain}
          </Badge>
        ) : null}
      </div>
      <div className="p-4 space-y-4">
        {rows.map((r) => {
          const unlimited = r.limit < 0;
          const pct = unlimited ? 0 : Math.min(100, (r.used / Math.max(1, r.limit)) * 100);
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="tabular-nums font-mono text-foreground">
                  {formatBytes(r.used)}
                  {!unlimited ? (
                    <span className="text-muted-foreground">
                      {" / "}
                      {formatBytes(r.limit)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground"> / ∞</span>
                  )}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500/70 to-indigo-500/70 transition-all"
                  style={{ width: unlimited ? `${Math.min(100, r.used / 1)}%` : `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
          <div className="rounded-md border border-border/60 p-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Streams
            </div>
            <div className="mt-1 tabular-nums font-mono text-foreground">
              {a.streams}
              {limits && limits.maxStreams >= 0 ? (
                <span className="text-muted-foreground"> / {limits.maxStreams}</span>
              ) : null}
            </div>
          </div>
          <div className="rounded-md border border-border/60 p-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Consumers
            </div>
            <div className="mt-1 tabular-nums font-mono text-foreground">
              {a.consumers}
              {limits && limits.maxConsumers >= 0 ? (
                <span className="text-muted-foreground"> / {limits.maxConsumers}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopStreamsCard({
  streams,
  connectionId,
  jetstreamEnabled,
}: {
  streams: { name: string; messages: number; bytes: number; consumers: number }[];
  connectionId: string;
  jetstreamEnabled: boolean;
}) {
  const max = streams[0]?.messages ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="size-4 text-sky-500" />
          Top streams
        </h3>
        <Link
          href={`/nats/${connectionId}/streams`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open ›
        </Link>
      </div>
      {!jetstreamEnabled ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          JetStream disabled.
        </div>
      ) : streams.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No streams yet.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {streams.map((s) => {
            const pct = max > 0 ? Math.max(2, (s.messages / max) * 100) : 0;
            return (
              <Link
                key={s.name}
                href={`/nats/${connectionId}/streams`}
                className="block group"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate group-hover:text-foreground text-foreground/80">
                    {s.name}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(s.messages)}
                    <span className="ml-1 text-[10px]">
                      · {formatBytes(s.bytes)}
                    </span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all"
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

function ServerCard({ overview }: { overview: Overview }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Network className="size-4" />
          Server details
        </h3>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border/40">
        <Detail label="Server ID" value={overview.serverId} />
        <Detail
          label="Client ID"
          value={overview.clientId != null ? String(overview.clientId) : undefined}
        />
        <Detail
          label="Max payload"
          value={
            overview.maxPayload != null
              ? formatBytes(overview.maxPayload)
              : undefined
          }
        />
        <Detail
          label="Proto"
          value={
            overview.protoVersion != null ? `v${overview.protoVersion}` : undefined
          }
        />
      </div>
      {overview.connectUrls.length > 0 ? (
        <div className="px-4 py-3 border-t border-border/40 text-xs">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
            cluster urls
          </div>
          <div className="flex flex-wrap gap-1.5">
            {overview.connectUrls.map((u) => (
              <span
                key={u}
                className="font-mono text-[11px] rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5"
              >
                {u}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-xs truncate text-foreground">
        {value ?? "—"}
      </div>
    </div>
  );
}
