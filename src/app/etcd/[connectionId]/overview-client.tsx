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
  Key,
  Crown,
  Database,
  Boxes,
  Server,
  Users,
} from "lucide-react";

interface MemberInfo {
  id: string;
  name: string;
  peerURLs: string[];
  clientURLs: string[];
  isLearner: boolean;
  isLeader: boolean;
}

interface Overview {
  version: string;
  cluster: string;
  memberCount: number;
  leaderId: string | null;
  dbSizeBytes: number;
  dbSizeInUseBytes: number;
  raftTerm: string;
  raftIndex: string;
  totalKeys: number;
  members: MemberInfo[];
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shortId(id: string): string {
  // etcd member IDs are huge numerics; show last 6 hex digits like etcdctl.
  try {
    const hex = BigInt(id).toString(16);
    return hex.slice(-6);
  } catch {
    return id.slice(-6);
  }
}

export function OverviewClient({ connectionId }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/etcd/${connectionId}/overview`, {
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
          ? `etcd ${overview.version} · ${overview.memberCount} member${overview.memberCount === 1 ? "" : "s"}${overview.leaderId ? ` · leader ${shortId(overview.leaderId)}` : ""}`
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

          <MemberPulseStrip members={overview.members} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Users className="size-3.5" />}
              label="Members"
              value={overview.memberCount}
              sub={
                overview.members.some((m) => m.isLearner)
                  ? "includes learners"
                  : "all voters"
              }
            />
            <StatTile
              icon={<Key className="size-3.5" />}
              label="Keys"
              value={overview.totalKeys}
              valueCompact
              sub="entire keyspace"
              href={`/etcd/${connectionId}/keys`}
            />
            <StatTile
              icon={<Database className="size-3.5" />}
              label="DB size"
              value={formatBytes(overview.dbSizeBytes)}
              raw
              sub={`${formatBytes(overview.dbSizeInUseBytes)} in use`}
            />
            <StatTile
              icon={<Crown className="size-3.5" />}
              label="Leader"
              value={overview.leaderId ? shortId(overview.leaderId) : "—"}
              raw
              sub={`raft term ${overview.raftTerm} · idx ${overview.raftIndex}`}
            />
          </div>

          <MembersCard members={overview.members} />
          <RaftCard overview={overview} />
        </div>
      )}
    </WorkspacePage>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function MemberPulseStrip({ members }: { members: MemberInfo[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-lime-500/5 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Boxes className="size-4 text-lime-600" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Cluster status
            </p>
            <p className="text-sm font-semibold">
              {members.length} member{members.length === 1 ? "" : "s"}
              <span className="text-muted-foreground font-normal">
                {" · "}
                {members.filter((m) => m.isLearner).length} learner
                {members.filter((m) => m.isLearner).length === 1 ? "" : "s"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {members.map((m) => (
            <span
              key={m.id}
              title={`${m.name} — ${m.clientURLs.join(", ")}${m.isLeader ? " (leader)" : ""}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono",
                "border bg-background/40 hover:bg-background transition-colors",
                m.isLeader
                  ? "border-lime-500/60 text-lime-700 dark:text-lime-300 shadow-sm shadow-lime-500/20"
                  : m.isLearner
                    ? "border-amber-500/40 text-amber-700 dark:text-amber-300"
                    : "border-border/60 text-foreground/80"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  m.isLeader
                    ? "bg-lime-500 status-pulse"
                    : m.isLearner
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                )}
              />
              {m.name || shortId(m.id)}
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
        <span className="text-3xl font-semibold tabular-nums tracking-tight font-mono">
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

function MembersCard({ members }: { members: MemberInfo[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Server className="size-4" />
          Members
        </h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {members.length} total
        </span>
      </div>
      {members.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No member information available.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {members.map((m) => (
            <div key={m.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      m.isLeader
                        ? "bg-lime-500 status-pulse"
                        : m.isLearner
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    )}
                  />
                  <span className="font-mono text-xs truncate">
                    <span className="text-muted-foreground">name </span>
                    <span className="text-foreground">
                      {m.name || "(unnamed)"}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    id {shortId(m.id)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {m.isLeader ? (
                    <Badge
                      variant="secondary"
                      className="bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30 text-[10px] font-mono uppercase tracking-wider"
                    >
                      leader
                    </Badge>
                  ) : null}
                  {m.isLearner ? (
                    <Badge
                      variant="secondary"
                      className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px] font-mono uppercase tracking-wider"
                    >
                      learner
                    </Badge>
                  ) : null}
                </div>
              </div>
              {m.clientURLs.length > 0 ? (
                <div className="text-[11px] font-mono text-muted-foreground truncate">
                  <span className="text-foreground/50">client </span>
                  {m.clientURLs.join(", ")}
                </div>
              ) : null}
              {m.peerURLs.length > 0 ? (
                <div className="text-[11px] font-mono text-muted-foreground truncate">
                  <span className="text-foreground/50">peer </span>
                  {m.peerURLs.join(", ")}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RaftCard({ overview }: { overview: Overview }) {
  const usagePct =
    overview.dbSizeBytes > 0
      ? Math.round(
          (overview.dbSizeInUseBytes / overview.dbSizeBytes) * 100
        )
      : 0;
  const rows: [string, string][] = [
    ["Version", overview.version],
    ["Cluster ID", overview.cluster ? shortId(overview.cluster) : "—"],
    ["Raft term", overview.raftTerm],
    ["Raft index", overview.raftIndex],
    ["DB size", formatBytes(overview.dbSizeBytes)],
    ["DB in use", `${formatBytes(overview.dbSizeInUseBytes)} (${usagePct}%)`],
  ];
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="size-4 text-lime-600" />
          Raft &amp; storage
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
