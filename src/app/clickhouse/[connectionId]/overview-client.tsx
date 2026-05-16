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
  Database,
  HardDrive,
  Hash,
  Zap,
  Clock,
} from "lucide-react";

interface TopTable {
  name: string;
  rows: number;
  bytes: number;
}

interface Overview {
  version: string;
  uptimeSeconds: number;
  database: string;
  tableCount: number;
  totalRows: number;
  totalBytes: number;
  runningQueries: number;
  topTablesByRows: TopTable[];
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
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function OverviewClient({ connectionId }: Props) {
  const [summary, setSummary] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clickhouse/${connectionId}/overview`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setSummary(data as Overview);
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
      title="Server"
      description={
        summary
          ? `database ${summary.database}`
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

          {/* ── Server pulse strip ────────────────────────────────────────── */}
          <ServerStrip
            version={summary.version}
            uptime={summary.uptimeSeconds}
            database={summary.database}
          />

          {/* ── Big stats ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Database className="size-3.5" />}
              label="Tables"
              value={summary.tableCount}
              href={`/clickhouse/${connectionId}/tables`}
            />
            <StatTile
              icon={<Hash className="size-3.5" />}
              label="Rows"
              value={summary.totalRows}
              valueCompact
              sub="user tables"
            />
            <StatTile
              icon={<HardDrive className="size-3.5" />}
              label="Bytes"
              valueText={formatBytes(summary.totalBytes)}
              sub="on disk"
            />
            <StatTile
              icon={<Zap className="size-3.5" />}
              label="Running"
              value={summary.runningQueries}
              sub="queries in flight"
              tone={summary.runningQueries > 0 ? "warn" : "default"}
            />
          </div>

          {/* ── Top tables ────────────────────────────────────────────────── */}
          <TopTablesCard
            tables={summary.topTablesByRows}
            totalRows={summary.totalRows}
            connectionId={connectionId}
          />
        </div>
      )}
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ServerStrip({
  version,
  uptime,
  database,
}: {
  version: string;
  uptime: number;
  database: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-gradient-to-r from-yellow-500/5 via-transparent to-transparent p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
            <Database className="size-4 text-yellow-500" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Server
            </p>
            <p className="text-sm font-semibold">
              ClickHouse{" "}
              <span className="font-mono">v{version || "?"}</span>
              <span className="text-muted-foreground font-normal">
                {" · "}database{" "}
                <span className="font-mono text-foreground">{database}</span>
              </span>
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-mono uppercase tracking-wider border border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300">
          <Clock className="size-3" />
          up {formatUptime(uptime)}
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
  tone = "default",
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueCompact?: boolean;
  valueText?: string;
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
          {valueText ??
            (valueCompact
              ? formatCompact(value ?? 0)
              : fmt.format(value ?? 0))}
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

function TopTablesCard({
  tables,
  totalRows,
  connectionId,
}: {
  tables: TopTable[];
  totalRows: number;
  connectionId: string;
}) {
  const max = tables[0]?.rows ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Hash className="size-4 text-yellow-500" />
          Top tables by rows
        </h3>
        <Link
          href={`/clickhouse/${connectionId}/tables`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open ›
        </Link>
      </div>
      {tables.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No user tables yet.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {tables.map((t) => {
            const pct = max > 0 ? Math.max(2, (t.rows / max) * 100) : 0;
            const share = totalRows > 0 ? (t.rows / totalRows) * 100 : 0;
            return (
              <div key={t.name} className="block">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate text-foreground/80">
                    {t.name}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(t.rows)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all"
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
