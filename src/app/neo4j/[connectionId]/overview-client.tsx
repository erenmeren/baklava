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
  ArrowRight,
  Database,
  GitBranch,
  Hash,
  Network,
  RefreshCcw,
  Server,
} from "lucide-react";

interface DatabaseSummary {
  name: string;
  address?: string;
  role?: string;
  requestedStatus?: string;
  currentStatus?: string;
  default: boolean;
  home: boolean;
}

interface Overview {
  server: {
    name: string;
    versions: string[];
    edition: string;
    address?: string;
  };
  databases: DatabaseSummary[];
  totals: {
    onlineDatabases: number;
    totalNodes: number;
    totalRelationships: number;
    totalIndexes: number;
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

export function OverviewClient({ connectionId }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/neo4j/${connectionId}/overview`, {
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

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <WorkspacePage
      title="Server"
      description={
        overview
          ? `${overview.server.name} ${overview.server.versions[0] ?? ""} · ${
              overview.server.edition
            } edition`
          : undefined
      }
      actions={
        <>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500 status-pulse" />
            auto · 30s
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

          <ServerStrip server={overview.server} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Database className="size-3.5" />}
              label="Databases"
              value={overview.totals.onlineDatabases}
              sub={`${overview.databases.length} total`}
              href={`/neo4j/${connectionId}/databases`}
            />
            <StatTile
              icon={<Hash className="size-3.5" />}
              label="Nodes"
              value={overview.totals.totalNodes}
              valueCompact
              sub="across user databases"
            />
            <StatTile
              icon={<GitBranch className="size-3.5" />}
              label="Relationships"
              value={overview.totals.totalRelationships}
              valueCompact
              sub="directed edges"
            />
            <StatTile
              icon={<Network className="size-3.5" />}
              label="Indexes"
              value={overview.totals.totalIndexes}
              sub="all types"
            />
          </div>

          <DatabasesCard
            databases={overview.databases}
            connectionId={connectionId}
          />
        </div>
      )}
    </WorkspacePage>
  );
}

function ServerStrip({ server }: { server: Overview["server"] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-cyan-500/10 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Server className="size-4 text-cyan-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Server
            </p>
            <p className="text-sm font-semibold">
              {server.name}{" "}
              <span className="font-mono text-foreground">
                {server.versions[0] ?? ""}
              </span>
              {server.edition ? (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  {server.edition} edition
                </span>
              ) : null}
            </p>
          </div>
        </div>
        {server.address ? (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-mono border border-border/60 bg-background/40 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {server.address}
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

function DatabasesCard({
  databases,
  connectionId,
}: {
  databases: DatabaseSummary[];
  connectionId: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="size-4 text-cyan-500" />
          Databases
        </h3>
        <Link
          href={`/neo4j/${connectionId}/databases`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Open <ArrowRight className="size-3" />
        </Link>
      </div>
      {databases.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No databases reported.
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {databases.map((db) => (
            <li
              key={db.name}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <StatusDot status={db.currentStatus} />
                <Link
                  href={`/neo4j/${connectionId}/databases/${encodeURIComponent(db.name)}`}
                  className="font-mono text-xs hover:text-foreground text-foreground/90 truncate"
                >
                  {db.name}
                </Link>
                {db.role ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-mono uppercase tracking-wider"
                  >
                    {db.role.toLowerCase()}
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {db.default ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-mono uppercase tracking-wider bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30"
                  >
                    default
                  </Badge>
                ) : null}
                <StatusPill status={db.currentStatus} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusDot({ status }: { status?: string }) {
  const cls = statusColor(status);
  return <span className={cn("size-2 rounded-full shrink-0", cls)} />;
}

function StatusPill({ status }: { status?: string }) {
  const label = (status ?? "unknown").toLowerCase();
  const tone = statusPillTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border",
        tone
      )}
    >
      {label}
    </span>
  );
}

function statusColor(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "online":
      return "bg-emerald-500";
    case "starting":
    case "stopping":
      return "bg-amber-500 status-pulse";
    case "offline":
    case "stopped":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function statusPillTone(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "online":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "starting":
    case "stopping":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40";
    case "offline":
    case "stopped":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40";
    default:
      return "bg-muted/50 text-muted-foreground border-border/60";
  }
}
