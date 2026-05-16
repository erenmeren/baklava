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
  Activity,
  Database,
  FileText,
  HardDrive,
  RefreshCcw,
  Rows3,
} from "lucide-react";

interface Overview {
  version: string;
  fileSize: number;
  pageCount: number;
  pageSize: number;
  journalMode: string;
  walAutoCheckpoint: number;
  userTableCount: number;
  systemTableCount: number;
  indexCount: number;
  viewCount: number;
  triggerCount: number;
  encoding: string;
  topTablesBySize: { name: string; rowCount: number; system: boolean }[];
}

interface Props {
  connectionId: string;
}

const fmt = new Intl.NumberFormat("en-US");

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

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
      const res = await fetch(`/api/sqlite/${connectionId}/overview`, {
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
      title="Database"
      description={
        overview
          ? `SQLite ${overview.version} · ${formatBytes(overview.fileSize)}`
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

          {/* ── File pulse strip ──────────────────────────────────────────── */}
          <div className="rounded-lg border border-border/60 bg-gradient-to-r from-blue-500/5 via-transparent to-transparent p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
                  <FileText className="size-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    Database file
                  </p>
                  <p className="text-sm font-semibold">
                    SQLite {overview.version}
                    <span className="text-muted-foreground font-normal">
                      {" · "}
                      <span className="font-mono text-foreground">
                        {formatBytes(overview.fileSize)}
                      </span>
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-1">
                  journal · {overview.journalMode}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-1">
                  {overview.encoding}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Database className="size-3.5" />}
              label="Tables"
              value={overview.userTableCount}
              sub={
                overview.systemTableCount > 0
                  ? `+ ${overview.systemTableCount} system`
                  : undefined
              }
              href={`/sqlite/${connectionId}/tables`}
            />
            <StatTile
              icon={<HardDrive className="size-3.5" />}
              label="File size"
              value={overview.fileSize}
              format={formatBytes}
              sub={`${fmt.format(overview.pageCount)} × ${fmt.format(overview.pageSize)}B pages`}
            />
            <StatTile
              icon={<Activity className="size-3.5" />}
              label="Indexes"
              value={overview.indexCount}
              sub={
                overview.viewCount + overview.triggerCount > 0
                  ? `${overview.viewCount} view · ${overview.triggerCount} trig`
                  : undefined
              }
            />
            <StatTile
              icon={<Rows3 className="size-3.5" />}
              label="Pages"
              value={overview.pageCount}
              format={formatCompact}
            />
          </div>

          <TopTablesCard
            tables={overview.topTablesBySize}
            connectionId={connectionId}
          />
        </div>
      )}
    </WorkspacePage>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function StatTile({
  icon,
  label,
  value,
  sub,
  format,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  format?: (n: number) => string;
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
          {format ? format(value) : fmt.format(value)}
        </span>
      </div>
      {sub ? (
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      ) : null}
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

function TopTablesCard({
  tables,
  connectionId,
}: {
  tables: { name: string; rowCount: number; system: boolean }[];
  connectionId: string;
}) {
  const max = tables[0]?.rowCount ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Rows3 className="size-4 text-blue-500" />
          Top tables by row count
        </h3>
        <Link
          href={`/sqlite/${connectionId}/tables`}
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
            const pct = max > 0 ? Math.max(2, (t.rowCount / max) * 100) : 0;
            return (
              <div key={t.name} className="block group">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate text-foreground/80 flex items-center gap-2">
                    {t.name}
                    {t.system ? (
                      <Badge
                        variant="secondary"
                        className="text-[9px] font-mono uppercase tracking-wider"
                      >
                        system
                      </Badge>
                    ) : null}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatCompact(t.rowCount)} rows
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all"
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
