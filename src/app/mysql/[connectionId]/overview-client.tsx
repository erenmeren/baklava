"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  AutoRefresh,
  DEFAULT_REFRESH_INTERVALS,
} from "@/components/workspace/auto-refresh";
import {
  Activity,
  Database,
  Gauge,
  HardDrive,
  HourglassIcon,
  Layers,
  Plug,
  SquareTerminal,
  Table as TableIcon,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types (mirror src/lib/connections/mysql.ts) ─────────────────────────────
interface Overview {
  serverVersion: string;
  currentUser: string;
  currentDatabase: string;
  uptimeSeconds: number;
  maxConnections: number;
  threadsConnected: number;
  threadsRunning: number;
  totalQueries: number;
  queriesPerSecond: number;
  bufferPoolHitRatio: number;
  totalDatabasesSize: number;
  databases: Array<{
    name: string;
    charset: string;
    collation: string;
    tableCount: number;
    size: number;
  }>;
}

interface TopTable {
  database: string;
  name: string;
  engine: string | null;
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

// ─── format helpers ──────────────────────────────────────────────────────────
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
function shortVersion(v: string | null | undefined): string {
  if (!v) return "MySQL";
  // version() returns e.g. "8.0.36" or "10.11.6-MariaDB" — keep first token.
  const token = v.split(/[-\s]/)[0];
  return /MariaDB/i.test(v) ? `MariaDB ${token}` : `MySQL ${token}`;
}
function formatRate(rate: number): string {
  if (rate < 1) return rate.toFixed(2);
  if (rate >= 1000) return `${(rate / 1000).toFixed(1)}k`;
  return Math.round(rate).toString();
}

const REFRESH_MS = 5_000;

export function OverviewClient({
  connectionId,
  connectionName,
  defaultDatabase,
  hostPort,
}: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [topTables, setTopTables] = useState<TopTable[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadAll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const [oRes, tRes] = await Promise.all([
        fetch(`/api/mysql/${connectionId}/overview`, {
          cache: "no-store",
          signal: controller.signal,
        }),
        fetch(`/api/mysql/${connectionId}/top-tables?limit=10`, {
          cache: "no-store",
          signal: controller.signal,
        }),
      ]);
      if (oRes.ok) {
        const body = (await oRes.json()) as { overview?: Overview } | Overview;
        const o = (body as { overview?: Overview }).overview ?? (body as Overview);
        setOverview(o);
        setError(null);
      } else {
        const body = await oRes.json().catch(() => ({}));
        setError((body as { error?: string }).error || "Could not load overview");
      }
      if (tRes.ok) {
        const body = (await tRes.json()) as { tables?: TopTable[] };
        setTopTables(body.tables ?? []);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Could not load overview");
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Abort any in-flight fetch on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const connPct = overview
    ? (overview.threadsConnected / Math.max(1, overview.maxConnections)) * 100
    : 0;
  const connTone = connPct >= 85 ? "alert" : connPct >= 70 ? "warn" : "neutral";
  const runningTone = overview && overview.threadsRunning > 50 ? "warn" : "ok";
  const hitTone =
    overview && overview.bufferPoolHitRatio > 0
      ? overview.bufferPoolHitRatio < 0.95
        ? "alert"
        : overview.bufferPoolHitRatio < 0.99
          ? "warn"
          : "ok"
      : "neutral";

  const newQueryHref = `/mysql/${connectionId}/databases/${encodeURIComponent(
    defaultDatabase || "_",
  )}/query`;

  return (
    <WorkspacePage
      title={connectionName}
      description={
        overview ? (
          <span className="inline-flex items-center gap-2 text-xs font-mono">
            <span>{shortVersion(overview.serverVersion)}</span>
            <span className="text-border" aria-hidden>·</span>
            <span>{hostPort}</span>
            <span className="text-border" aria-hidden>·</span>
            <span>up {formatUptime(overview.uptimeSeconds)}</span>
          </span>
        ) : (
          <span className="text-xs font-mono text-muted-foreground">
            {hostPort} · loading…
          </span>
        )
      }
      actions={
        <>
          <AutoRefresh
            intervalMs={REFRESH_MS}
            intervals={DEFAULT_REFRESH_INTERVALS}
            onTick={loadAll}
            loading={loading}
          />
          <Link
            href={newQueryHref}
            className={cn(buttonVariants({ size: "sm" }))}
          >
            <SquareTerminal className="size-3.5" />
            New query
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        {error ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/[0.05] px-4 py-3 text-xs font-mono text-red-700 dark:text-red-400">
            {error}
          </div>
        ) : null}

        {/* HERO KPI STRIP */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <KpiTile
            icon={Plug}
            label="Connections"
            value={
              overview
                ? `${overview.threadsConnected}/${overview.maxConnections}`
                : "—"
            }
            sub={overview ? "threads connected" : "loading…"}
            bar={connPct}
            tone={connTone}
          />
          <KpiTile
            icon={Activity}
            label="Running"
            value={overview ? String(overview.threadsRunning) : "—"}
            sub={
              overview
                ? overview.threadsRunning <= 1
                  ? "idle server"
                  : "threads executing"
                : ""
            }
            tone={runningTone}
          />
          <KpiTile
            icon={Zap}
            label="Queries/sec"
            value={overview ? formatRate(overview.queriesPerSecond) : "—"}
            sub={
              overview
                ? `${formatNumber(overview.totalQueries)} total`
                : "observing…"
            }
            tone="neutral"
          />
          <KpiTile
            icon={Gauge}
            label="Buffer pool"
            value={
              overview && overview.bufferPoolHitRatio > 0
                ? `${(overview.bufferPoolHitRatio * 100).toFixed(2)}%`
                : "—"
            }
            sub="InnoDB hit ratio"
            tone={hitTone}
          />
          <KpiTile
            icon={HourglassIcon}
            label="Uptime"
            value={overview ? formatUptime(overview.uptimeSeconds) : "—"}
            sub={overview ? "since restart" : ""}
            tone="neutral"
          />
          <KpiTile
            icon={HardDrive}
            label="Total size"
            value={overview ? formatBytes(overview.totalDatabasesSize) : "—"}
            sub={
              overview
                ? `${overview.databases.length} database${overview.databases.length === 1 ? "" : "s"}`
                : ""
            }
            tone="neutral"
          />
        </div>

        {/* TWO COLUMNS — databases (left) + largest tables (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <DatabasesPanel
            overview={overview}
            connectionId={connectionId}
            currentDatabase={defaultDatabase}
          />
          <TopTablesPanel tables={topTables} connectionId={connectionId} />
        </div>
      </div>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI TILE
// ─────────────────────────────────────────────────────────────────────────────

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  bar,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
  bar?: number;
  tone: "alert" | "warn" | "ok" | "neutral";
}) {
  const ring =
    tone === "alert"
      ? "border-red-500/50 bg-red-500/[0.05]"
      : tone === "warn"
        ? "border-amber-500/50 bg-amber-500/[0.04]"
        : tone === "ok"
          ? "border-emerald-500/30 bg-emerald-500/[0.03]"
          : "border-border/60 bg-card/40";
  const accent =
    tone === "alert"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "ok"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-brand";
  const glowBg =
    tone === "alert"
      ? "bg-red-500/30"
      : tone === "warn"
        ? "bg-amber-500/30"
        : tone === "ok"
          ? "bg-emerald-500/30"
          : "bg-brand/15";

  return (
    <div className={cn("relative overflow-hidden rounded-xl border px-3 py-2.5", ring)}>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 size-16 rounded-full blur-2xl opacity-50",
          glowBg,
        )}
      />
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className={cn("size-3", accent)} />
        {label}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <div
          className={cn(
            "font-semibold tabular-nums text-lg leading-none tracking-tight",
            tone === "alert" && "text-red-600 dark:text-red-400",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
          )}
          style={{
            fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
          }}
        >
          {value}
        </div>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{sub}</div>
      {bar != null ? (
        <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              tone === "alert"
                ? "bg-red-500"
                : tone === "warn"
                  ? "bg-amber-500"
                  : "bg-brand",
            )}
            style={{ width: `${Math.min(100, Math.max(2, bar))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION HEADER
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Activity;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-2">
      <div className="flex items-baseline gap-2">
        <Icon className="size-3 text-muted-foreground translate-y-[1px]" />
        <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h2>
        {subtitle ? (
          <span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">
            · {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASES
// ─────────────────────────────────────────────────────────────────────────────

function DatabasesPanel({
  overview,
  connectionId,
  currentDatabase,
}: {
  overview: Overview | null;
  connectionId: string;
  currentDatabase: string;
}) {
  return (
    <section>
      <SectionHeader
        icon={Database}
        title="Databases"
        subtitle={overview ? `${overview.databases.length}` : "loading"}
      />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden divide-y divide-border/40">
        {overview == null ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : overview.databases.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No databases on this server.
          </p>
        ) : (
          overview.databases.map((d) => {
            const isCurrent = d.name === currentDatabase;
            return (
              <div
                key={d.name}
                className={cn(
                  "group px-3 py-2 transition-colors",
                  isCurrent ? "bg-brand/[0.06]" : "hover:bg-muted/30",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <Link
                      href={`/mysql/${connectionId}/databases/${encodeURIComponent(d.name)}/query`}
                      className="font-mono text-xs font-semibold truncate hover:underline"
                    >
                      {d.name}
                    </Link>
                    {isCurrent ? (
                      <span className="text-[9px] font-mono uppercase tracking-wider text-brand">
                        current
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                    {formatBytes(d.size)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2 text-[10px] font-mono text-muted-foreground tabular-nums">
                  <span>
                    {formatNumber(d.tableCount)} table
                    {d.tableCount === 1 ? "" : "s"}
                  </span>
                  <span>·</span>
                  <span title={d.collation} className="truncate">
                    {d.charset}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    href={`/mysql/${connectionId}/databases/${encodeURIComponent(d.name)}/query`}
                    className="inline-flex items-center gap-1 rounded border border-border/60 bg-card px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <SquareTerminal className="size-2.5" />
                    editor
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LARGEST TABLES
// ─────────────────────────────────────────────────────────────────────────────

function TopTablesPanel({
  tables,
  connectionId,
}: {
  tables: TopTable[] | null;
  connectionId: string;
}) {
  const dbCount = useMemo(
    () => (tables ? new Set(tables.map((t) => t.database)).size : 0),
    [tables],
  );
  return (
    <section>
      <SectionHeader
        icon={TableIcon}
        title="Largest tables"
        subtitle={
          tables == null
            ? "loading"
            : dbCount > 1
              ? `${tables.length} across ${dbCount} databases`
              : `top ${tables.length}`
        }
      />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden divide-y divide-border/40">
        {tables == null ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : tables.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No user tables anywhere on this server.
          </p>
        ) : (
          tables.map((t) => (
            <div key={`${t.database}.${t.name}`} className="group px-3 py-1.5">
              <div className="flex items-baseline justify-between gap-2 min-w-0">
                <Link
                  href={`/mysql/${connectionId}/databases/${encodeURIComponent(t.database)}/tables/${encodeURIComponent(t.name)}`}
                  className="font-mono text-xs truncate hover:underline"
                  title={`${t.database}.${t.name}`}
                >
                  <span className="text-muted-foreground/70">
                    {t.database}/
                  </span>
                  <span className="text-foreground">{t.name}</span>
                </Link>
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                  {formatBytes(t.totalSize)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 mt-0.5">
                <span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">
                  ~{formatNumber(t.rowEstimate)} rows · index{" "}
                  {formatBytes(t.indexSize)}
                </span>
                {t.engine ? (
                  <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
                    <Layers className="size-2.5" />
                    {t.engine}
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
