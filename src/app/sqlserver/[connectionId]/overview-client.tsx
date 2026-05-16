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
  Database,
  HardDrive,
  RefreshCcw,
  Server,
  Table as TableIcon,
  User,
} from "lucide-react";

interface DatabaseSummary {
  name: string;
  sizeBytes: number;
  tableCount: number;
  isSystem: boolean;
  state: string;
}

interface Overview {
  version: string;
  productVersion: string | null;
  edition: string | null;
  serverName: string | null;
  currentUser: string | null;
  collation: string | null;
  startTime: string | null;
  databaseCount: number;
  topDatabases: DatabaseSummary[];
}

interface Props {
  connectionId: string;
}

const fmt = new Intl.NumberFormat("en-US");

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} K`;
  if (n < 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} M`;
  if (n < 1024 * 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} G`;
  return `${(n / (1024 * 1024 * 1024 * 1024)).toFixed(1)} T`;
}

function formatUptime(start: string | null): string {
  if (!start) return "—";
  const ms = Date.now() - new Date(start).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export function OverviewClient({ connectionId }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setOverview(data as Overview);
      else {
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

  return (
    <WorkspacePage
      title="Instance"
      description={
        overview
          ? `${overview.edition ?? "SQL Server"}${
              overview.productVersion ? ` · ${overview.productVersion}` : ""
            } · ${overview.databaseCount} database${overview.databaseCount === 1 ? "" : "s"}`
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
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-6">
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <InstanceStrip overview={overview} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Database className="size-3.5" />}
              label="Databases"
              value={overview.databaseCount}
              href={`/sqlserver/${connectionId}/databases`}
            />
            <StatTile
              icon={<HardDrive className="size-3.5" />}
              label="Total size"
              valueText={formatBytes(
                overview.topDatabases.reduce((s, d) => s + d.sizeBytes, 0)
              )}
              sub="top 5 shown"
            />
            <StatTile
              icon={<User className="size-3.5" />}
              label="Connected as"
              valueText={overview.currentUser ?? "—"}
              mono
            />
            <StatTile
              icon={<Server className="size-3.5" />}
              label="Uptime"
              valueText={formatUptime(overview.startTime)}
            />
          </div>

          <TopDatabasesCard
            databases={overview.topDatabases}
            connectionId={connectionId}
          />
        </div>
      )}
    </WorkspacePage>
  );
}

function InstanceStrip({ overview }: { overview: Overview }) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-red-500/5 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Server className="size-4 text-rose-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Instance
            </p>
            <p className="text-sm font-semibold">
              {overview.serverName ?? "SQL Server"}
              {overview.productVersion ? (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  <span className="font-mono">{overview.productVersion}</span>
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          {overview.edition ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 border border-border/60 bg-background/40">
              <span className="text-muted-foreground">edition</span>
              <span>{overview.edition}</span>
            </span>
          ) : null}
          {overview.collation ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 border border-border/60 bg-background/40">
              <span className="text-muted-foreground">collation</span>
              <span>{overview.collation}</span>
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
  valueText,
  sub,
  mono,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueText?: string;
  sub?: string;
  mono?: boolean;
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
            "text-3xl font-semibold tabular-nums tracking-tight truncate",
            mono && "font-mono text-xl"
          )}
        >
          {valueText ?? (value != null ? fmt.format(value) : "—")}
        </span>
      </div>
      {sub ? (
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </>
  );
  const base = cn(
    "rounded-lg border p-4 bg-card transition-colors",
    "border-border/60 hover:bg-muted/30",
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

function TopDatabasesCard({
  databases,
  connectionId,
}: {
  databases: DatabaseSummary[];
  connectionId: string;
}) {
  const max = databases[0]?.sizeBytes ?? 0;
  const total = databases.reduce((s, d) => s + d.sizeBytes, 0);
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <HardDrive className="size-4 text-rose-500" />
          Top databases by size
        </h3>
        <Link
          href={`/sqlserver/${connectionId}/databases`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          All databases ›
        </Link>
      </div>
      {databases.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No databases on this instance.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {databases.map((d) => {
            const pct = max > 0 ? Math.max(2, (d.sizeBytes / max) * 100) : 0;
            const share = total > 0 ? (d.sizeBytes / total) * 100 : 0;
            return (
              <div key={d.name} className="block group">
                <div className="flex items-center justify-between text-xs mb-1 gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-mono truncate text-foreground/90">
                      {d.name}
                    </span>
                    {d.isSystem ? (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-mono uppercase tracking-wider border-border/60 text-muted-foreground"
                      >
                        system
                      </Badge>
                    ) : null}
                    <span className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1">
                      <TableIcon className="size-3" />
                      {d.tableCount}
                    </span>
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground shrink-0">
                    {formatBytes(d.sizeBytes)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-red-500 to-rose-600 transition-all"
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
