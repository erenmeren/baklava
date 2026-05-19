"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { AutoRefresh } from "@/components/workspace/auto-refresh";
import { Sparkline } from "@/components/workspace/sparkline";
import {
  Activity,
  AlertTriangle,
  Database,
  Flame,
  Gauge,
  HardDrive,
  HourglassIcon,
  Plug,
  Plus,
  RotateCcw,
  ShieldAlert,
  Skull,
  SquareTerminal,
  Table as TableIcon,
  Zap,
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

interface OverviewExtras {
  blockerCount: number;
  blockerChains: Array<{
    blockedPid: number;
    blockedQuery: string | null;
    blockedFor: number;
    blockedBy: number[];
  }>;
  oldestIdleInTxnSec: number | null;
  longestActiveQuerySec: number | null;
  databaseCounters: Array<{
    name: string;
    commits: number;
    rollbacks: number;
    hitPct: number | null;
    sampledAt: number;
  }>;
  hasPgStatStatements: boolean;
  topSlowQueries: Array<{
    query: string;
    calls: number;
    totalExecMs: number;
    meanExecMs: number;
    rows: number;
  }>;
  bloatHotspots: Array<{
    schema: string;
    table: string;
    nLive: number;
    nDead: number;
    deadPct: number;
    lastAutovacuum: string | null;
  }>;
}

interface ActivityRow {
  pid: number;
  database: string | null;
  user: string | null;
  applicationName: string | null;
  clientAddr: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  backendStart: string | null;
  xactStart: string | null;
  queryStart: string | null;
  stateChange: string | null;
  backendType: string | null;
  query: string | null;
  queryAgeSeconds: number | null;
}

interface TopTable {
  database: string;
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

// ─── format helpers ──────────────────────────────────────────────────────
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
function formatDuration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86_400).toFixed(1)}d`;
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
  if (!v) return "PostgreSQL";
  const m = v.match(/^PostgreSQL\s+[\d.]+/);
  return m ? m[0] : v.split(" ").slice(0, 2).join(" ");
}
function formatTps(rate: number): string {
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
  const [extras, setExtras] = useState<OverviewExtras | null>(null);
  const [topTables, setTopTables] = useState<TopTable[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [killingPid, setKillingPid] = useState<number | null>(null);

  // Per-(connection, db) rolling TPS history. The backend returns
  // monotonic counters; we diff between polls and store seconds-per-tx
  // values for the current DB.
  const prevCountersRef = useRef<Map<string, { commits: number; rollbacks: number; at: number }>>(
    new Map(),
  );
  const [tpsHistory, setTpsHistory] = useState<number[]>([]);
  const [currentTps, setCurrentTps] = useState<number>(0);
  const [rollbackPct, setRollbackPct] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, eRes, tRes, aRes] = await Promise.all([
        fetch(`/api/postgres/${connectionId}/overview`, { cache: "no-store" }),
        fetch(`/api/postgres/${connectionId}/overview-extras`, { cache: "no-store" }),
        fetch(
          `/api/postgres/${connectionId}/top-tables?limit=10`,
          { cache: "no-store" },
        ),
        fetch(`/api/postgres/${connectionId}/activity`, { cache: "no-store" }),
      ]);
      if (oRes.ok) {
        const body = (await oRes.json()) as { overview?: Overview } | Overview;
        // Backend wraps as { overview }; tolerate either shape.
        const o = (body as { overview?: Overview }).overview ?? (body as Overview);
        setOverview(o);
      }
      if (tRes.ok) setTopTables(((await tRes.json()).tables ?? []) as TopTable[]);
      if (aRes.ok) {
        const snap = (await aRes.json()) as { rows: ActivityRow[] };
        // Only show non-internal sessions, prioritize active + waiting
        const rows = (snap.rows ?? []).filter(
          (r) => r.backendType === "client backend" || r.backendType == null,
        );
        setActivity(rows);
      }
      if (eRes.ok) {
        const ex = (await eRes.json()) as OverviewExtras;
        setExtras(ex);
        // Compute TPS delta against previous sample (current DB only).
        const cur = ex.databaseCounters.find((d) => d.name === defaultDatabase);
        if (cur) {
          const prev = prevCountersRef.current.get(defaultDatabase);
          if (prev && cur.sampledAt > prev.at) {
            const dt = (cur.sampledAt - prev.at) / 1000;
            const tx = cur.commits + cur.rollbacks - prev.commits - prev.rollbacks;
            const tps = dt > 0 ? tx / dt : 0;
            setCurrentTps(tps);
            setTpsHistory((prev) => {
              const next = [...prev, tps];
              if (next.length > 30) next.shift();
              return next;
            });
            const totalNow = cur.commits + cur.rollbacks;
            const totalPrev = prev.commits + prev.rollbacks;
            const deltaTx = totalNow - totalPrev;
            const deltaRb = cur.rollbacks - prev.rollbacks;
            setRollbackPct(deltaTx > 0 ? (deltaRb / deltaTx) * 100 : null);
          }
          prevCountersRef.current.set(defaultDatabase, {
            commits: cur.commits,
            rollbacks: cur.rollbacks,
            at: cur.sampledAt,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId, defaultDatabase]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ─── per-DB derived metrics ─────────────────────────────────────────────
  const currentDbHit = useMemo(() => {
    const row = extras?.databaseCounters.find((d) => d.name === defaultDatabase);
    return row?.hitPct ?? null;
  }, [extras, defaultDatabase]);

  const connSaturation = overview
    ? overview.activeConnections + overview.idleConnections
    : 0;
  const connPct = overview
    ? (connSaturation / Math.max(1, overview.maxConnections)) * 100
    : 0;

  // ─── health badges (only render when something is non-green) ────────────
  const healthBadges: Array<{ kind: "alert" | "warn"; label: string }> = [];
  if (extras) {
    if (extras.blockerCount > 0) {
      healthBadges.push({
        kind: "alert",
        label: `${extras.blockerCount} blocked session${extras.blockerCount === 1 ? "" : "s"}`,
      });
    }
    if (extras.oldestIdleInTxnSec != null && extras.oldestIdleInTxnSec > 300) {
      healthBadges.push({
        kind: "alert",
        label: `idle-in-txn ${formatDuration(extras.oldestIdleInTxnSec)} old`,
      });
    } else if (extras.oldestIdleInTxnSec != null && extras.oldestIdleInTxnSec > 30) {
      healthBadges.push({
        kind: "warn",
        label: `idle-in-txn ${formatDuration(extras.oldestIdleInTxnSec)}`,
      });
    }
    if (extras.longestActiveQuerySec != null && extras.longestActiveQuerySec > 60) {
      healthBadges.push({
        kind: "warn",
        label: `query running ${formatDuration(extras.longestActiveQuerySec)}`,
      });
    }
    if (rollbackPct != null && rollbackPct > 5) {
      healthBadges.push({
        kind: "alert",
        label: `rollback ratio ${rollbackPct.toFixed(1)}%`,
      });
    } else if (rollbackPct != null && rollbackPct > 2) {
      healthBadges.push({
        kind: "warn",
        label: `rollback ratio ${rollbackPct.toFixed(1)}%`,
      });
    }
    if (currentDbHit != null && currentDbHit < 0.95) {
      healthBadges.push({
        kind: "alert",
        label: `cache hit ${(currentDbHit * 100).toFixed(1)}%`,
      });
    } else if (currentDbHit != null && currentDbHit < 0.99) {
      healthBadges.push({
        kind: "warn",
        label: `cache hit ${(currentDbHit * 100).toFixed(2)}%`,
      });
    }
    for (const b of extras.bloatHotspots) {
      if (b.deadPct > 0.4) {
        healthBadges.push({
          kind: "alert",
          label: `${b.schema}.${b.table} ${(b.deadPct * 100).toFixed(0)}% dead`,
        });
      }
    }
  }

  const handleKill = useCallback(
    async (pid: number, action: "cancel" | "terminate") => {
      setKillingPid(pid);
      try {
        const res = await fetch(
          `/api/postgres/${connectionId}/activity/${pid}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        const data = await res.json();
        if (res.ok) {
          toast.success(
            action === "cancel" ? "Cancel signal sent" : "Backend terminated",
          );
          await loadAll();
        } else {
          toast.error(data.error || "Could not signal backend");
        }
      } finally {
        setKillingPid(null);
      }
    },
    [connectionId, loadAll],
  );

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
            onTick={loadAll}
            loading={loading}
          />
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New database
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* HERO KPI STRIP */}
        <KpiStrip
          overview={overview}
          extras={extras}
          connPct={connPct}
          currentDbHit={currentDbHit}
          currentTps={currentTps}
          tpsHistory={tpsHistory}
          rollbackPct={rollbackPct}
        />

        {/* HEALTH BADGES (only if any non-green signal) */}
        {healthBadges.length > 0 ? (
          <HealthBadgeRow badges={healthBadges} />
        ) : null}

        {/* TWO COLUMNS — Activity (left) + Structure (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* LEFT: 3/5 columns — slow queries + blockers + activity */}
          <div className="lg:col-span-3 space-y-5">
            <SlowQueriesPanel
              extras={extras}
              connectionId={connectionId}
              defaultDatabase={defaultDatabase}
            />

            {extras && extras.blockerCount > 0 ? (
              <BlockersPanel
                chains={extras.blockerChains}
                onKill={handleKill}
                killingPid={killingPid}
              />
            ) : null}

            <ActiveSessionsPanel
              rows={activity}
              currentDatabase={defaultDatabase}
              onKill={handleKill}
              killingPid={killingPid}
              connectionId={connectionId}
            />

            {extras && extras.bloatHotspots.length > 0 ? (
              <BloatPanel
                rows={extras.bloatHotspots}
                connectionId={connectionId}
                defaultDatabase={defaultDatabase}
              />
            ) : null}
          </div>

          {/* RIGHT: 2/5 columns — databases + top tables + recent queries */}
          <div className="lg:col-span-2 space-y-5">
            <DatabasesPanel
              overview={overview}
              extras={extras}
              connectionId={connectionId}
              currentDatabase={defaultDatabase}
            />

            <TopTablesPanel
              tables={topTables}
              connectionId={connectionId}
            />
          </div>
        </div>
      </div>

      <CreateDatabaseDialog
        connectionId={connectionId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={loadAll}
      />
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HERO KPI STRIP
// ─────────────────────────────────────────────────────────────────────────

function KpiStrip({
  overview,
  extras,
  connPct,
  currentDbHit,
  currentTps,
  tpsHistory,
  rollbackPct,
}: {
  overview: Overview | null;
  extras: OverviewExtras | null;
  connPct: number;
  currentDbHit: number | null;
  currentTps: number;
  tpsHistory: number[];
  rollbackPct: number | null;
}) {
  const connTone =
    connPct >= 85 ? "alert" : connPct >= 70 ? "warn" : "neutral";
  const blockerTone =
    extras && extras.blockerCount > 0 ? "alert" : "ok";
  const idleTone =
    extras?.oldestIdleInTxnSec != null && extras.oldestIdleInTxnSec > 300
      ? "alert"
      : extras?.oldestIdleInTxnSec != null && extras.oldestIdleInTxnSec > 30
        ? "warn"
        : "ok";
  const hitTone =
    currentDbHit != null && currentDbHit < 0.95
      ? "alert"
      : currentDbHit != null && currentDbHit < 0.99
        ? "warn"
        : "ok";
  const rbTone =
    rollbackPct != null && rollbackPct > 5
      ? "alert"
      : rollbackPct != null && rollbackPct > 2
        ? "warn"
        : "neutral";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <KpiTile
        icon={Plug}
        label="Connections"
        value={
          overview
            ? `${overview.activeConnections + overview.idleConnections}/${overview.maxConnections}`
            : "—"
        }
        sub={
          overview
            ? `${overview.activeConnections} active · ${overview.idleConnections} idle`
            : "loading…"
        }
        bar={connPct}
        tone={connTone}
      />
      <KpiTile
        icon={extras && extras.blockerCount > 0 ? ShieldAlert : Activity}
        label="Blockers"
        value={extras ? String(extras.blockerCount) : "—"}
        sub={
          extras
            ? extras.blockerCount === 0
              ? "nothing waiting on a lock"
              : "active lock contention"
            : ""
        }
        tone={blockerTone}
      />
      <KpiTile
        icon={HourglassIcon}
        label="Idle in txn"
        value={formatDuration(extras?.oldestIdleInTxnSec ?? null)}
        sub={
          extras?.oldestIdleInTxnSec == null
            ? "none"
            : extras.oldestIdleInTxnSec > 300
              ? "blocking autovacuum"
              : extras.oldestIdleInTxnSec > 30
                ? "watch this"
                : "fine"
        }
        tone={idleTone}
      />
      <KpiTile
        icon={Zap}
        label="TPS"
        value={currentTps > 0 ? formatTps(currentTps) : "—"}
        sub={
          rollbackPct != null
            ? `${rollbackPct.toFixed(1)}% rollback`
            : "observing…"
        }
        spark={tpsHistory.length > 1 ? tpsHistory : undefined}
        tone={rbTone}
      />
      <KpiTile
        icon={Gauge}
        label="Cache hit"
        value={
          currentDbHit != null
            ? `${(currentDbHit * 100).toFixed(2)}%`
            : "—"
        }
        sub="current database"
        tone={hitTone}
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
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  bar,
  spark,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
  bar?: number;
  spark?: number[];
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
        {spark ? (
          <Sparkline values={spark} width={60} height={18} tone="neutral" className={accent} />
        ) : null}
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

// ─────────────────────────────────────────────────────────────────────────
// HEALTH BADGES
// ─────────────────────────────────────────────────────────────────────────

function HealthBadgeRow({
  badges,
}: {
  badges: Array<{ kind: "alert" | "warn"; label: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mr-1">
        Watch
      </span>
      {badges.map((b, i) => (
        <span
          key={i}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
            "text-[10px] font-mono uppercase tracking-wider",
            b.kind === "alert"
              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              b.kind === "alert"
                ? "bg-red-500 status-pulse"
                : "bg-amber-500",
            )}
          />
          {b.label}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ACTIVE SESSIONS
// ─────────────────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  right,
}: {
  icon: typeof Activity;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
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
      {right}
    </div>
  );
}

function ActiveSessionsPanel({
  rows,
  currentDatabase,
  onKill,
  killingPid,
  connectionId,
}: {
  rows: ActivityRow[] | null;
  currentDatabase: string;
  onKill: (pid: number, action: "cancel" | "terminate") => void;
  killingPid: number | null;
  connectionId: string;
}) {
  // Surface most-interesting first: active > waiting > idle-in-txn > idle
  const top = useMemo(() => {
    if (!rows) return [];
    const order = (r: ActivityRow) =>
      r.state === "active"
        ? r.waitEventType
          ? 1
          : 0
        : r.state === "idle in transaction"
          ? 2
          : 3;
    return [...rows].sort((a, b) => order(a) - order(b)).slice(0, 5);
  }, [rows]);

  return (
    <section>
      <SectionHeader
        icon={Activity}
        title="Active sessions"
        subtitle={rows ? `${rows.length} total · showing top ${top.length}` : "loading"}
        right={
          <Link
            href={`/postgres/${connectionId}/activity`}
            className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            view all →
          </Link>
        }
      />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
        {rows == null ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : top.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No client sessions right now.
          </p>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/40">
              <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-2 py-1.5 text-left w-16">PID</th>
                <th className="px-2 py-1.5 text-left w-28">State</th>
                <th className="px-2 py-1.5 text-left w-16">Age</th>
                <th className="px-2 py-1.5 text-left">Query</th>
                <th className="px-2 py-1.5 text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <SessionRow
                  key={r.pid}
                  row={r}
                  isCurrentDb={r.database === currentDatabase}
                  onKill={onKill}
                  killing={killingPid === r.pid}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function SessionRow({
  row,
  isCurrentDb,
  onKill,
  killing,
}: {
  row: ActivityRow;
  isCurrentDb: boolean;
  onKill: (pid: number, action: "cancel" | "terminate") => void;
  killing: boolean;
}) {
  const stateTone =
    row.state === "active"
      ? row.waitEventType
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
      : row.state === "idle in transaction"
        ? "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
        : "bg-muted text-muted-foreground border-border/60";
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30 transition-colors">
      <td className="px-2 py-1.5 align-top text-muted-foreground tabular-nums">
        {row.pid}
      </td>
      <td className="px-2 py-1.5 align-top">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[9px] uppercase tracking-wider",
            stateTone,
          )}
        >
          {row.state ?? "—"}
          {row.waitEvent ? (
            <span className="opacity-75">· {row.waitEvent}</span>
          ) : null}
        </span>
        {!isCurrentDb && row.database ? (
          <span className="ml-1 text-[9px] text-muted-foreground/60">
            on {row.database}
          </span>
        ) : null}
      </td>
      <td className="px-2 py-1.5 align-top text-muted-foreground tabular-nums">
        {formatDuration(row.queryAgeSeconds)}
      </td>
      <td className="px-2 py-1.5 align-top max-w-[36ch] truncate">
        <span className="text-foreground/90" title={row.query ?? ""}>
          {row.query?.replace(/\s+/g, " ").trim() || (
            <span className="text-muted-foreground/50">(no query)</span>
          )}
        </span>
      </td>
      <td className="px-2 py-1 align-top text-right">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={killing}
            onClick={() => onKill(row.pid, "cancel")}
            title="Cancel current query (pg_cancel_backend)"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 disabled:opacity-50"
          >
            <RotateCcw className="size-3" />
          </button>
          <button
            type="button"
            disabled={killing}
            onClick={() => onKill(row.pid, "terminate")}
            title="Terminate session (pg_terminate_backend)"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10 disabled:opacity-50"
          >
            <Skull className="size-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BLOCKERS
// ─────────────────────────────────────────────────────────────────────────

function BlockersPanel({
  chains,
  onKill,
  killingPid,
}: {
  chains: OverviewExtras["blockerChains"];
  onKill: (pid: number, action: "cancel" | "terminate") => void;
  killingPid: number | null;
}) {
  return (
    <section>
      <SectionHeader
        icon={ShieldAlert}
        title="Lock contention"
        subtitle={`${chains.length} blocked session${chains.length === 1 ? "" : "s"}`}
      />
      <div className="rounded-xl border border-red-500/40 bg-red-500/[0.04] overflow-hidden">
        {chains.map((c) => (
          <div
            key={c.blockedPid}
            className="border-b border-red-500/20 last:border-b-0 px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2 font-mono text-xs">
                <span className="font-semibold tabular-nums text-red-700 dark:text-red-300">
                  pid {c.blockedPid}
                </span>
                <span className="text-muted-foreground">blocked by</span>
                {c.blockedBy.map((pid) => (
                  <span
                    key={pid}
                    className="inline-flex items-center rounded bg-red-500/15 px-1.5 py-0 text-[10px] tabular-nums text-red-700 dark:text-red-300"
                  >
                    {pid}
                  </span>
                ))}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                waiting {formatDuration(c.blockedFor)}
              </span>
            </div>
            <div className="mt-1 text-[11px] font-mono text-muted-foreground line-clamp-2">
              {c.blockedQuery?.replace(/\s+/g, " ").trim() || "(no query)"}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              {[c.blockedPid, ...c.blockedBy].map((pid) => (
                <button
                  key={pid}
                  type="button"
                  disabled={killingPid === pid}
                  onClick={() => onKill(pid, "terminate")}
                  title={`Terminate pid ${pid}`}
                  className="inline-flex items-center gap-1 rounded border border-red-500/30 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-red-700 dark:text-red-300 hover:bg-red-500/15 disabled:opacity-50"
                >
                  <Skull className="size-2.5" />
                  kill {pid}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SLOW QUERIES + pg_stat_statements CTA
// ─────────────────────────────────────────────────────────────────────────

function SlowQueriesPanel({
  extras,
  connectionId,
  defaultDatabase,
}: {
  extras: OverviewExtras | null;
  connectionId: string;
  defaultDatabase: string;
}) {
  if (extras == null) {
    return (
      <section>
        <SectionHeader icon={Flame} title="Slowest queries" />
        <Skeleton className="h-32 w-full" />
      </section>
    );
  }
  if (!extras.hasPgStatStatements) {
    return (
      <section>
        <SectionHeader icon={Flame} title="Slowest queries" />
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 py-5 text-center">
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            <span className="font-mono text-foreground">
              pg_stat_statements
            </span>{" "}
            is not installed. Without it we can&apos;t surface the slowest
            queries on this server.
          </p>
          <Link
            href={`/postgres/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/query?prefill=${encodeURIComponent(
              "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;",
            )}`}
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-brand hover:bg-brand/15"
          >
            <SquareTerminal className="size-3" />
            Open editor with install SQL
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section>
      <SectionHeader
        icon={Flame}
        title="Slowest queries"
        subtitle={`top ${extras.topSlowQueries.length} by total time`}
      />
      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden divide-y divide-border/40">
        {extras.topSlowQueries.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No slow queries recorded yet.
          </p>
        ) : (
          extras.topSlowQueries.map((q, i) => (
            <div key={i} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2 mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div className="tabular-nums">
                  total {(q.totalExecMs / 1000).toFixed(2)}s ·{" "}
                  mean {q.meanExecMs.toFixed(2)}ms ·{" "}
                  {formatNumber(q.calls)} call{q.calls === 1 ? "" : "s"}
                </div>
                <Link
                  href={`/postgres/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/query?prefill=${encodeURIComponent(q.query)}`}
                  className="text-brand hover:underline"
                >
                  open →
                </Link>
              </div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/90 line-clamp-3">
                {q.query.trim()}
              </pre>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BLOAT HOTSPOTS
// ─────────────────────────────────────────────────────────────────────────

function BloatPanel({
  rows,
  connectionId,
  defaultDatabase,
}: {
  rows: OverviewExtras["bloatHotspots"];
  connectionId: string;
  defaultDatabase: string;
}) {
  return (
    <section>
      <SectionHeader
        icon={AlertTriangle}
        title="Bloat hotspots"
        subtitle={`${rows.length} table${rows.length === 1 ? "" : "s"} >20% dead`}
      />
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.04] overflow-hidden">
        <table className="w-full text-xs font-mono">
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.schema}.${r.table}`} className="border-b border-amber-500/15 last:border-b-0">
                <td className="px-3 py-1.5">
                  <Link
                    href={`/postgres/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/schemas/${encodeURIComponent(r.schema)}/tables/${encodeURIComponent(r.table)}`}
                    className="hover:underline"
                  >
                    {r.schema}.{r.table}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right text-amber-700 dark:text-amber-300 tabular-nums">
                  {(r.deadPct * 100).toFixed(0)}% dead
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                  {formatNumber(r.nDead)} / {formatNumber(r.nLive + r.nDead)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DATABASES (right column)
// ─────────────────────────────────────────────────────────────────────────

function DatabasesPanel({
  overview,
  extras,
  connectionId,
  currentDatabase,
}: {
  overview: Overview | null;
  extras: OverviewExtras | null;
  connectionId: string;
  currentDatabase: string;
}) {
  const counterByName = useMemo(() => {
    const m = new Map<string, { hitPct: number | null }>();
    extras?.databaseCounters.forEach((c) => m.set(c.name, { hitPct: c.hitPct }));
    return m;
  }, [extras]);
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
        ) : (
          overview.databases.map((d) => {
            const isCurrent = d.name === currentDatabase;
            const hit = counterByName.get(d.name)?.hitPct ?? null;
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
                      href={`/postgres/${connectionId}/databases/${encodeURIComponent(d.name)}`}
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
                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                    {formatBytes(d.size)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2 text-[10px] font-mono text-muted-foreground tabular-nums">
                  <span>{d.connections} conn</span>
                  <span>·</span>
                  <span>{d.owner}</span>
                  {hit != null ? (
                    <>
                      <span>·</span>
                      <span
                        className={cn(
                          hit < 0.95
                            ? "text-red-600 dark:text-red-400"
                            : hit < 0.99
                              ? "text-amber-600 dark:text-amber-400"
                              : "",
                        )}
                      >
                        hit {(hit * 100).toFixed(1)}%
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    href={`/postgres/${connectionId}/databases/${encodeURIComponent(d.name)}/query`}
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

// ─────────────────────────────────────────────────────────────────────────
// TOP TABLES (right column)
// ─────────────────────────────────────────────────────────────────────────

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
            <div
              key={`${t.database}.${t.schema}.${t.name}`}
              className="group px-3 py-1.5"
            >
              <div className="flex items-baseline justify-between gap-2 min-w-0">
                <Link
                  href={`/postgres/${connectionId}/databases/${encodeURIComponent(t.database)}/schemas/${encodeURIComponent(t.schema)}/tables/${encodeURIComponent(t.name)}`}
                  className="font-mono text-xs truncate hover:underline"
                  title={`${t.database}.${t.schema}.${t.name}`}
                >
                  <span className="text-muted-foreground/70">
                    {t.database}/
                  </span>
                  <span className="text-muted-foreground">{t.schema}.</span>
                  <span className="text-foreground">{t.name}</span>
                </Link>
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                  {formatBytes(t.totalSize)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 mt-0.5">
                <span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">
                  ~{formatNumber(t.rowEstimate)} rows · index {formatBytes(t.indexSize)}
                </span>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  <Link
                    href={`/postgres/${connectionId}/databases/${encodeURIComponent(t.database)}/schemas/${encodeURIComponent(t.schema)}/tables/${encodeURIComponent(t.name)}`}
                    className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    data
                  </Link>
                  <Link
                    href={`/postgres/${connectionId}/databases/${encodeURIComponent(t.database)}/schemas/${encodeURIComponent(t.schema)}/tables/${encodeURIComponent(t.name)}?tab=indexes`}
                    className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    indexes
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

