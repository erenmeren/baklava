"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  Activity,
  Database,
  FileText,
  HardDrive,
  Loader2,
  Plus,
  RefreshCcw,
  Server,
  Shield,
  Table as TableIcon,
  Clock,
  Gauge,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CreateDatabaseDialog } from "./create-database-dialog";

interface Overview {
  serverVersion: string;
  currentUser: string;
  currentDatabase: string;
  uptimeSeconds: number;
  maxConnections: number;
  activeConnections: number;
  idleConnections: number;
  cacheHitRatio: number;
  totalDatabasesSize: number;
  databases: Array<{
    name: string;
    owner: string;
    encoding: string;
    size: number;
    connections: number;
  }>;
}

interface TopTable {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view";
  rowEstimate: number;
  totalSize: number;
  indexSize: number;
}

interface Props {
  connectionId: string;
  connectionName: string;
  defaultDatabase: string;
  hostPort: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  for (const u of units) {
    if (value < 1024) {
      return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${u}`;
    }
    value /= 1024;
  }
  return `${Math.round(value)} PB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function shortVersion(v: string): string {
  // "PostgreSQL 16.13 on …" → "PostgreSQL 16.13"
  const m = v.match(/^PostgreSQL\s+[\d.]+/);
  return m ? m[0] : v.split(" ").slice(0, 2).join(" ");
}

export function OverviewClient({
  connectionId,
  connectionName,
  defaultDatabase,
  hostPort,
}: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [topTables, setTopTables] = useState<TopTable[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [createDbOpen, setCreateDbOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, ttRes] = await Promise.all([
        fetch(`/api/postgres/${connectionId}/overview`, { cache: "no-store" }),
        fetch(
          `/api/postgres/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/top-tables?limit=10`,
          { cache: "no-store" },
        ),
      ]);
      const ovData = await ovRes.json();
      if (!ovRes.ok) {
        toast.error("Could not load overview", { description: ovData.error });
      } else {
        setOverview(ovData.overview as Overview);
      }
      const ttData = await ttRes.json();
      if (ttRes.ok) {
        setTopTables(ttData.tables as TopTable[]);
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId, defaultDatabase]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <WorkspacePage
      title={connectionName}
      description={
        <span className="text-xs">
          <span className="font-mono">{hostPort}</span>
          {overview ? (
            <> · default database <span className="font-mono">{overview.currentDatabase}</span></>
          ) : null}
        </span>
      }
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
            Refresh
          </Button>
          <Link
            href={`/postgres/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/query`}
            className="inline-flex items-center gap-1.5 text-sm border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
          >
            <FileText className="size-3.5" />
            Open SQL editor
          </Link>
        </>
      }
    >
      <div className="space-y-6">
        {/* Hero stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <HeroCard
            icon={<Server className="size-3.5" />}
            label="Server"
            value={overview ? shortVersion(overview.serverVersion) : "—"}
            hint={
              overview
                ? `${overview.currentUser}@${overview.currentDatabase}`
                : undefined
            }
            loading={!overview}
          />
          <HeroCard
            icon={<Clock className="size-3.5" />}
            label="Uptime"
            value={overview ? formatUptime(overview.uptimeSeconds) : "—"}
            hint={overview ? "since postmaster start" : undefined}
            loading={!overview}
          />
          <HeroCard
            icon={<Activity className="size-3.5" />}
            label="Connections"
            value={
              overview
                ? `${overview.activeConnections + overview.idleConnections} / ${overview.maxConnections}`
                : "—"
            }
            hint={
              overview
                ? `${overview.activeConnections} active · ${overview.idleConnections} idle`
                : undefined
            }
            loading={!overview}
            warn={
              overview
                ? (overview.activeConnections + overview.idleConnections) /
                    overview.maxConnections >
                  0.8
                : false
            }
          />
          <HeroCard
            icon={<Gauge className="size-3.5" />}
            label="Cache hit"
            value={
              overview
                ? `${(overview.cacheHitRatio * 100).toFixed(2)}%`
                : "—"
            }
            hint={
              overview
                ? overview.cacheHitRatio >= 0.99
                  ? "healthy (≥99%)"
                  : overview.cacheHitRatio >= 0.9
                    ? "warm"
                    : "cold — consider more RAM"
                : undefined
            }
            loading={!overview}
            warn={overview ? overview.cacheHitRatio < 0.9 : false}
          />
        </div>

        {/* Databases */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
              <Database className="size-3" />
              Databases{" "}
              {overview ? (
                <span className="font-mono normal-case tracking-normal text-[10.5px] text-muted-foreground/70">
                  {overview.databases.length} · {formatBytes(overview.totalDatabasesSize)} total
                </span>
              ) : null}
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateDbOpen(true)}
            >
              <Plus className="size-3.5" />
              New database
            </Button>
          </div>
          {overview ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs font-mono border-collapse">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-semibold border-b border-border/60">
                      Name
                    </th>
                    <th className="text-right px-3 py-1.5 font-semibold border-b border-border/60">
                      Size
                    </th>
                    <th className="text-right px-3 py-1.5 font-semibold border-b border-border/60">
                      Connections
                    </th>
                    <th className="text-left px-3 py-1.5 font-semibold border-b border-border/60">
                      Owner
                    </th>
                    <th className="text-left px-3 py-1.5 font-semibold border-b border-border/60">
                      Encoding
                    </th>
                    <th className="border-b border-border/60 w-px" />
                  </tr>
                </thead>
                <tbody>
                  {overview.databases.map((db) => {
                    const isCurrent = db.name === overview.currentDatabase;
                    return (
                      <tr
                        key={db.name}
                        className="group border-b border-border/30 hover:bg-foreground/[0.025] last:border-b-0"
                      >
                        <td className="px-3 py-1.5 align-middle">
                          <span className="inline-flex items-center gap-1.5">
                            {isCurrent ? (
                              <span
                                className="size-1.5 rounded-full bg-brand"
                                title="default database for this connection"
                              />
                            ) : (
                              <span className="size-1.5" aria-hidden />
                            )}
                            <span className="text-foreground">{db.name}</span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5 align-middle text-right tabular-nums">
                          {formatBytes(db.size)}
                        </td>
                        <td className="px-3 py-1.5 align-middle text-right tabular-nums text-muted-foreground">
                          {db.connections}
                        </td>
                        <td className="px-3 py-1.5 align-middle text-muted-foreground">
                          {db.owner}
                        </td>
                        <td className="px-3 py-1.5 align-middle text-muted-foreground">
                          {db.encoding}
                        </td>
                        <td className="px-2 py-1 align-middle whitespace-nowrap">
                          <Link
                            href={`/postgres/${connectionId}/databases/${encodeURIComponent(db.name)}/query`}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10.5px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                          >
                            sql →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </section>

        {/* Top tables */}
        <section className="space-y-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
            <HardDrive className="size-3" />
            Top tables in{" "}
            <span className="font-mono normal-case tracking-normal text-[11px] text-foreground/80">
              {defaultDatabase}
            </span>
          </h2>
          {topTables === null ? (
            <Skeleton className="h-32 w-full" />
          ) : topTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No user tables in <span className="font-mono">{defaultDatabase}</span>.
            </p>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs font-mono border-collapse">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-semibold border-b border-border/60">
                      Table
                    </th>
                    <th className="text-right px-3 py-1.5 font-semibold border-b border-border/60">
                      Rows
                    </th>
                    <th className="text-right px-3 py-1.5 font-semibold border-b border-border/60">
                      Size
                    </th>
                    <th className="text-right px-3 py-1.5 font-semibold border-b border-border/60">
                      Indexes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topTables.map((t) => (
                    <tr
                      key={`${t.schema}.${t.name}`}
                      className="border-b border-border/30 hover:bg-foreground/[0.025] last:border-b-0"
                    >
                      <td className="px-3 py-1.5 align-middle">
                        <Link
                          href={`/postgres/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/schemas/${encodeURIComponent(t.schema)}/tables/${encodeURIComponent(t.name)}`}
                          className="inline-flex items-center gap-1.5 hover:text-brand transition-colors"
                        >
                          <TableIcon className="size-3 text-muted-foreground" />
                          <span className="text-foreground">{t.schema}.{t.name}</span>
                          {t.kind === "materialized_view" ? (
                            <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1">
                              mat
                            </span>
                          ) : null}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 align-middle text-right tabular-nums text-muted-foreground">
                        {t.rowEstimate >= 0 ? formatNumber(t.rowEstimate) : "—"}
                      </td>
                      <td className="px-3 py-1.5 align-middle text-right tabular-nums">
                        {formatBytes(t.totalSize)}
                      </td>
                      <td className="px-3 py-1.5 align-middle text-right tabular-nums text-muted-foreground">
                        {formatBytes(t.indexSize)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
            <Shield className="size-3" />
            Server
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/postgres/${connectionId}/roles`}
              className="inline-flex items-center gap-1.5 text-xs border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors font-mono"
            >
              <Shield className="size-3.5" />
              Roles
            </Link>
            <Link
              href={`/postgres/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/query`}
              className="inline-flex items-center gap-1.5 text-xs border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors font-mono"
            >
              <FileText className="size-3.5" />
              SQL editor
            </Link>
          </div>
        </section>
      </div>

      <CreateDatabaseDialog
        open={createDbOpen}
        onOpenChange={setCreateDbOpen}
        connectionId={connectionId}
        onCreated={() => load()}
      />
    </WorkspacePage>
  );
}

function HeroCard({
  icon,
  label,
  value,
  hint,
  loading,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5",
        warn ? "border-destructive/40" : "border-border/60",
      )}
    >
      <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground/80 inline-flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-1.5 h-5 w-3/4" />
      ) : (
        <div
          className={cn(
            "mt-1 text-[16px] font-mono tabular-nums truncate",
            warn ? "text-destructive" : "text-foreground",
          )}
          title={value}
        >
          {value}
        </div>
      )}
      {hint && !loading ? (
        <div className="text-[10.5px] font-mono text-muted-foreground mt-0.5 truncate">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
