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
  HardDrive,
  Layers,
  Plug,
  RefreshCcw,
  Timer,
} from "lucide-react";

interface Overview {
  version: string;
  uptimeSeconds: number;
  currentConnections: number;
  availableConnections: number;
  databaseCount: number;
  totalDataSize: number;
  totalStorageSize: number;
  totalCollectionCount: number;
  topDatabasesBySize: { name: string; sizeOnDisk: number; system: boolean }[];
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

function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function OverviewClient({ connectionId }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mongo/${connectionId}/overview`, {
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
      title="Server"
      description={
        overview
          ? `MongoDB ${overview.version} · ${overview.databaseCount} database${overview.databaseCount === 1 ? "" : "s"}`
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

          {/* ── Server pulse strip ────────────────────────────────────────── */}
          <div className="rounded-lg border border-border/60 bg-gradient-to-r from-emerald-500/5 via-transparent to-transparent p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-md border border-border/60 grid place-items-center bg-background/50">
                  <Activity className="size-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    Server status
                  </p>
                  <p className="text-sm font-semibold">
                    MongoDB {overview.version}
                    <span className="text-muted-foreground font-normal">
                      {" · "}up{" "}
                      <span className="font-mono text-foreground">
                        {formatUptime(overview.uptimeSeconds)}
                      </span>
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Plug className="size-3.5 text-emerald-500" />
                  {fmt.format(overview.currentConnections)} conn
                </span>
                {overview.availableConnections > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-foreground/60">
                      {fmt.format(overview.availableConnections)} free
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              icon={<Database className="size-3.5" />}
              label="Databases"
              value={overview.databaseCount}
              href={`/mongo/${connectionId}/databases`}
            />
            <StatTile
              icon={<Layers className="size-3.5" />}
              label="Collections"
              value={overview.totalCollectionCount}
              sub="user databases"
            />
            <StatTile
              icon={<HardDrive className="size-3.5" />}
              label="Data size"
              value={overview.totalDataSize}
              format={formatBytes}
            />
            <StatTile
              icon={<Timer className="size-3.5" />}
              label="Uptime"
              value={overview.uptimeSeconds}
              format={formatUptime}
            />
          </div>

          <TopDatabasesCard
            databases={overview.topDatabasesBySize}
            connectionId={connectionId}
            totalSize={overview.totalDataSize}
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

function TopDatabasesCard({
  databases,
  connectionId,
  totalSize,
}: {
  databases: { name: string; sizeOnDisk: number; system: boolean }[];
  connectionId: string;
  totalSize: number;
}) {
  const max = databases[0]?.sizeOnDisk ?? 0;
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <HardDrive className="size-4 text-emerald-500" />
          Top databases by size
        </h3>
        <Link
          href={`/mongo/${connectionId}/databases`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open ›
        </Link>
      </div>
      {databases.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No databases found.
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {databases.map((d) => {
            const pct = max > 0 ? Math.max(2, (d.sizeOnDisk / max) * 100) : 0;
            const share =
              totalSize > 0 ? (d.sizeOnDisk / totalSize) * 100 : 0;
            return (
              <div key={d.name} className="block group">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono truncate text-foreground/80 flex items-center gap-2">
                    {d.name}
                    {d.system ? (
                      <Badge
                        variant="secondary"
                        className="text-[9px] font-mono uppercase tracking-wider"
                      >
                        system
                      </Badge>
                    ) : null}
                  </span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatBytes(d.sizeOnDisk)}
                    {share >= 1 ? (
                      <span className="ml-1 text-[10px]">
                        · {share.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all"
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
