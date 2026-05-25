"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  AutoRefresh,
  DEFAULT_REFRESH_INTERVALS,
} from "@/components/workspace/auto-refresh";
import {
  Activity,
  Database,
  Flame,
  Gauge,
  HardDrive,
  HourglassIcon,
  Plug,
  Plus,
  ShieldAlert,
  Skull,
  SquareTerminal,
  Table as TableIcon,
  Timer,
  Waves,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CreateDatabaseDialog } from "./create-database-dialog";

// ─── Types (mirror the driver) ───────────────────────────────────────────

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
  uptimeSeconds: number;
  databaseCount: number;
  totalDatabasesSize: number;
  topDatabases: DatabaseSummary[];
  maxConnections: number;
  activeConnections: number;
  idleConnections: number;
  cacheHitRatio: number | null;
}

interface BlockerChain {
  blockedSpid: number;
  blockedFor: number;
  blockedQuery: string | null;
  blockedBy: number[];
}

interface WaitBucket {
  bucket: string;
  waitSeconds: number;
}

interface OverviewExtras {
  blockerCount: number;
  blockerChains: BlockerChain[];
  oldestIdleInTxnSec: number | null;
  longestActiveQuerySec: number | null;
  topWaits: WaitBucket[];
}

interface ExpensiveQuery {
  text: string;
  executionCount: number;
  totalWorkerTimeMs: number;
  avgWorkerTimeMs: number;
  totalLogicalReads: number;
  avgLogicalReads: number;
  lastExecution: string | null;
}

interface ActivityRow {
  sessionId: number;
  loginName: string | null;
  hostName: string | null;
  programName: string | null;
  databaseName: string | null;
  status: string | null;
  command: string | null;
  waitType: string | null;
  waitClass: string;
  blockingSessionId: number | null;
  cpuTime: number;
  reads: number;
  writes: number;
  openTransactions: number;
  elapsedMs: number | null;
  text: string | null;
  isUserProcess: boolean;
}

interface Props {
  connectionId: string;
  connectionName: string;
  defaultDatabase: string;
  hostPort: string;
}

// ─── Format helpers ──────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  for (const u of units) {
    if (value < 1024) {
      return `${
        value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)
      } ${u}`;
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
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86_400).toFixed(1)}d`;
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function shortVersion(productVersion: string | null, edition: string | null): string {
  const parts: string[] = [];
  if (edition) parts.push(edition.replace(/Edition$/i, "").trim());
  if (productVersion) parts.push(productVersion);
  return parts.join(" · ") || "SQL Server";
}

// ─── Main component ──────────────────────────────────────────────────────
//
// The AutoRefresh pill below defaults to paused (`defaultPlaying={false}`).
// SQL Server is the tech most likely to be a real managed instance whose
// queries cost money, so an idle overview tab generates zero background
// traffic until the user explicitly hits play (or the manual Refresh).

export function OverviewClient({
  connectionId,
  connectionName,
  defaultDatabase,
  hostPort,
}: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [extras, setExtras] = useState<OverviewExtras | null>(null);
  const [topQueries, setTopQueries] = useState<ExpensiveQuery[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [killingPid, setKillingPid] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, eRes, qRes, aRes] = await Promise.all([
        fetch(`/api/sqlserver/${connectionId}/overview`, { cache: "no-store" }),
        fetch(`/api/sqlserver/${connectionId}/overview-extras`, {
          cache: "no-store",
        }),
        fetch(`/api/sqlserver/${connectionId}/expensive-queries`, {
          cache: "no-store",
        }),
        fetch(`/api/sqlserver/${connectionId}/activity`, { cache: "no-store" }),
      ]);
      if (oRes.ok) setOverview((await oRes.json()) as Overview);
      if (eRes.ok) setExtras((await eRes.json()) as OverviewExtras);
      if (qRes.ok) {
        const body = (await qRes.json()) as { queries: ExpensiveQuery[] };
        setTopQueries(body.queries ?? []);
      }
      if (aRes.ok) {
        const body = (await aRes.json()) as { sessions: ActivityRow[] };
        setActivity((body.sessions ?? []).filter((r) => r.isUserProcess));
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ─── Derived metrics ──────────────────────────────────────────────────
  const connTotal = overview
    ? overview.activeConnections + overview.idleConnections
    : 0;
  const connPct = overview
    ? (connTotal / Math.max(1, overview.maxConnections)) * 100
    : 0;

  // ─── Health badges (only if non-green) ────────────────────────────────
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
    } else if (
      extras.oldestIdleInTxnSec != null &&
      extras.oldestIdleInTxnSec > 30
    ) {
      healthBadges.push({
        kind: "warn",
        label: `idle-in-txn ${formatDuration(extras.oldestIdleInTxnSec)}`,
      });
    }
    if (
      extras.longestActiveQuerySec != null &&
      extras.longestActiveQuerySec > 60
    ) {
      healthBadges.push({
        kind: "warn",
        label: `query running ${formatDuration(extras.longestActiveQuerySec)}`,
      });
    }
  }
  if (overview) {
    if (overview.cacheHitRatio != null && overview.cacheHitRatio < 0.95) {
      healthBadges.push({
        kind: "alert",
        label: `cache hit ${(overview.cacheHitRatio * 100).toFixed(1)}%`,
      });
    } else if (
      overview.cacheHitRatio != null &&
      overview.cacheHitRatio < 0.99
    ) {
      healthBadges.push({
        kind: "warn",
        label: `cache hit ${(overview.cacheHitRatio * 100).toFixed(2)}%`,
      });
    }
    if (connPct >= 85) {
      healthBadges.push({
        kind: "alert",
        label: `connections ${connPct.toFixed(0)}% of cap`,
      });
    } else if (connPct >= 70) {
      healthBadges.push({
        kind: "warn",
        label: `connections ${connPct.toFixed(0)}% of cap`,
      });
    }
  }

  const handleKill = useCallback(
    async (spid: number) => {
      setKillingPid(spid);
      try {
        const res = await fetch(
          `/api/sqlserver/${connectionId}/activity/${spid}`,
          { method: "POST" },
        );
        const data = await res.json();
        if (res.ok) {
          toast.success(`Session ${spid} killed`);
          await loadAll();
        } else {
          toast.error(data.error || "Could not KILL session");
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
            <span>{shortVersion(overview.productVersion, overview.edition)}</span>
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
            intervalMs={15_000}
            intervals={DEFAULT_REFRESH_INTERVALS}
            defaultPlaying={false}
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
        <KpiStrip overview={overview} extras={extras} connPct={connPct} />

        {healthBadges.length > 0 ? (
          <HealthBadgeRow badges={healthBadges} />
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 space-y-5">
            <ExpensiveQueriesPanel
              queries={topQueries}
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
            />
          </div>

          <div className="lg:col-span-2 space-y-5">
            <DatabasesPanel
              overview={overview}
              connectionId={connectionId}
              currentDatabase={defaultDatabase}
            />
            <TopWaitsPanel waits={extras?.topWaits ?? null} />
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

// ─── KPI strip ───────────────────────────────────────────────────────────

function KpiStrip({
  overview,
  extras,
  connPct,
}: {
  overview: Overview | null;
  extras: OverviewExtras | null;
  connPct: number;
}) {
  const connTone: Tone =
    connPct >= 85 ? "alert" : connPct >= 70 ? "warn" : "neutral";
  const blockerTone: Tone =
    extras == null ? "neutral" : extras.blockerCount > 0 ? "alert" : "ok";
  const idleTone: Tone =
    extras?.oldestIdleInTxnSec == null
      ? "neutral"
      : extras.oldestIdleInTxnSec > 300
        ? "alert"
        : extras.oldestIdleInTxnSec > 30
          ? "warn"
          : "ok";
  const longTone: Tone =
    extras?.longestActiveQuerySec == null
      ? "neutral"
      : extras.longestActiveQuerySec > 60
        ? "warn"
        : "neutral";
  const hitTone: Tone =
    overview?.cacheHitRatio == null
      ? "neutral"
      : overview.cacheHitRatio < 0.95
        ? "alert"
        : overview.cacheHitRatio < 0.99
          ? "warn"
          : "ok";

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
              ? "no lock contention"
              : "sessions waiting on locks"
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
              ? "holding txn open"
              : extras.oldestIdleInTxnSec > 30
                ? "watch this"
                : "fine"
        }
        tone={idleTone}
      />
      <KpiTile
        icon={Timer}
        label="Longest query"
        value={formatDuration(extras?.longestActiveQuerySec ?? null)}
        sub={
          extras?.longestActiveQuerySec == null
            ? "nothing running"
            : extras.longestActiveQuerySec > 60
              ? "running >1m"
              : "fast"
        }
        tone={longTone}
      />
      <KpiTile
        icon={Gauge}
        label="Cache hit"
        value={
          overview?.cacheHitRatio != null
            ? `${(overview.cacheHitRatio * 100).toFixed(2)}%`
            : "—"
        }
        sub="buffer manager"
        tone={hitTone}
      />
      <KpiTile
        icon={HardDrive}
        label="Total size"
        value={overview ? formatBytes(overview.totalDatabasesSize) : "—"}
        sub={
          overview
            ? `${overview.databaseCount} database${overview.databaseCount === 1 ? "" : "s"}`
            : ""
        }
        tone="neutral"
      />
    </div>
  );
}

type Tone = "alert" | "warn" | "ok" | "neutral";

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
  tone: Tone;
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
      ? "text-red-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "ok"
          ? "text-emerald-500"
          : "text-rose-500";
  const barColor =
    tone === "alert"
      ? "bg-red-500"
      : tone === "warn"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors relative overflow-hidden",
        ring,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1.5">
          <Icon className={cn("size-3", accent)} />
          {label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums tracking-tight truncate">
          {value}
        </span>
      </div>
      <p className="mt-0.5 text-[10.5px] text-muted-foreground truncate">{sub}</p>
      {bar != null ? (
        <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full transition-all", barColor)}
            style={{ width: `${Math.min(100, Math.max(0, bar))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ─── Health badges ───────────────────────────────────────────────────────

function HealthBadgeRow({
  badges,
}: {
  badges: Array<{ kind: "alert" | "warn"; label: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <Flame className="size-3.5 text-amber-500 shrink-0" />
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mr-1">
        Signals
      </span>
      {badges.map((b, i) => (
        <Badge
          key={i}
          variant="outline"
          className={cn(
            "text-[10.5px] font-mono tracking-tight",
            b.kind === "alert"
              ? "border-red-500/50 bg-red-500/[0.06] text-red-500"
              : "border-amber-500/50 bg-amber-500/[0.05] text-amber-600 dark:text-amber-400",
          )}
        >
          {b.label}
        </Badge>
      ))}
    </div>
  );
}

// ─── Expensive queries panel ─────────────────────────────────────────────

function ExpensiveQueriesPanel({
  queries,
  connectionId,
  defaultDatabase,
}: {
  queries: ExpensiveQuery[] | null;
  connectionId: string;
  defaultDatabase: string;
}) {
  return (
    <PanelCard
      title="Top queries · plan cache"
      icon={<Flame className="size-3.5 text-rose-500" />}
      action={
        <Link
          href={`/sqlserver/${connectionId}/queries`}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          All queries ›
        </Link>
      }
    >
      {queries === null ? (
        <Skeleton className="h-24" />
      ) : queries.length === 0 ? (
        <EmptyRow>No queries in the plan cache yet.</EmptyRow>
      ) : (
        <ul className="divide-y divide-border/40">
          {queries.slice(0, 6).map((q, i) => (
            <li key={i} className="py-2.5 first:pt-0 last:pb-0 group">
              <div className="flex items-baseline gap-2 text-[11px] font-mono text-muted-foreground mb-1">
                <span className="tabular-nums text-foreground">
                  {formatDuration(q.totalWorkerTimeMs / 1000)}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {formatNumber(q.executionCount)} runs
                </span>
                <span aria-hidden>·</span>
                <span>
                  avg {formatDuration(q.avgWorkerTimeMs / 1000)}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {formatNumber(q.totalLogicalReads)} reads
                </span>
              </div>
              <Link
                href={`/sqlserver/${connectionId}/databases/${encodeURIComponent(defaultDatabase)}/query`}
                className="block"
              >
                <pre className="text-[11.5px] font-mono leading-snug text-foreground/85 line-clamp-2 whitespace-pre-wrap break-all group-hover:text-foreground">
                  {q.text || "(no text — handle expired)"}
                </pre>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

// ─── Blockers panel (only when there are any) ────────────────────────────

function BlockersPanel({
  chains,
  onKill,
  killingPid,
}: {
  chains: BlockerChain[];
  onKill: (spid: number) => void;
  killingPid: number | null;
}) {
  return (
    <PanelCard
      title="Blocked sessions"
      icon={<ShieldAlert className="size-3.5 text-red-500" />}
      tone="alert"
    >
      <ul className="divide-y divide-border/40">
        {chains.map((c) => (
          <li
            key={c.blockedSpid}
            className="py-2.5 first:pt-0 last:pb-0 flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 text-[11px] font-mono mb-1">
                <span className="tabular-nums text-red-500 font-semibold">
                  spid {c.blockedSpid}
                </span>
                <span className="text-muted-foreground">blocked for</span>
                <span className="tabular-nums text-foreground">
                  {formatDuration(c.blockedFor)}
                </span>
                {c.blockedBy.length > 0 ? (
                  <>
                    <span className="text-muted-foreground">by</span>
                    <span className="tabular-nums text-foreground">
                      {c.blockedBy.map((id) => `spid ${id}`).join(", ")}
                    </span>
                  </>
                ) : null}
              </div>
              <pre className="text-[11px] font-mono leading-snug text-foreground/75 line-clamp-2 whitespace-pre-wrap break-all">
                {c.blockedQuery ?? "(no SQL text)"}
              </pre>
            </div>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onKill(c.blockedSpid)}
              disabled={killingPid === c.blockedSpid}
              className="text-red-500 hover:text-red-500 hover:bg-red-500/10"
              title="KILL session"
            >
              <Skull className="size-3" />
              KILL
            </Button>
          </li>
        ))}
      </ul>
    </PanelCard>
  );
}

// ─── Active sessions panel ───────────────────────────────────────────────

function ActiveSessionsPanel({
  rows,
  currentDatabase,
  onKill,
  killingPid,
}: {
  rows: ActivityRow[] | null;
  currentDatabase: string;
  onKill: (spid: number) => void;
  killingPid: number | null;
}) {
  // Surface running sessions first, then sleeping with open txns, then rest.
  const sorted = useMemo(() => {
    if (!rows) return null;
    return [...rows].sort((a, b) => {
      const pa = sessionPriority(a);
      const pb = sessionPriority(b);
      if (pa !== pb) return pa - pb;
      return (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0);
    });
  }, [rows]);
  return (
    <PanelCard
      title="Active sessions"
      icon={<Activity className="size-3.5 text-rose-500" />}
      sub={sorted ? `${sorted.length} user session${sorted.length === 1 ? "" : "s"}` : ""}
    >
      {sorted === null ? (
        <Skeleton className="h-24" />
      ) : sorted.length === 0 ? (
        <EmptyRow>No active user sessions.</EmptyRow>
      ) : (
        <ul className="divide-y divide-border/40">
          {sorted.slice(0, 10).map((r) => {
            const isCurrentDb = r.databaseName === currentDatabase;
            const tone = waitClassTone(r.waitClass);
            return (
              <li
                key={r.sessionId}
                className="py-2 first:pt-0 last:pb-0 grid grid-cols-[68px_1fr_auto] items-center gap-2"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                  <span className="tabular-nums">{r.sessionId}</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-sm px-1 py-px text-[9px] uppercase tracking-wider",
                      tone,
                    )}
                  >
                    {r.waitClass}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-mono text-muted-foreground truncate">
                    <span
                      className={cn(
                        isCurrentDb
                          ? "text-foreground"
                          : "text-muted-foreground/70",
                      )}
                    >
                      {r.databaseName ?? "—"}
                    </span>
                    {r.loginName ? (
                      <>
                        {" · "}
                        <span>{r.loginName}</span>
                      </>
                    ) : null}
                    {r.programName ? (
                      <>
                        {" · "}
                        <span className="truncate">{r.programName}</span>
                      </>
                    ) : null}
                    {r.elapsedMs != null && r.elapsedMs > 0 ? (
                      <>
                        {" · "}
                        <span className="tabular-nums">
                          {formatDuration(r.elapsedMs / 1000)}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <pre className="text-[11px] font-mono leading-snug text-foreground/85 line-clamp-1 whitespace-pre-wrap break-all">
                    {r.text?.trim() || `(${r.status ?? "no status"})`}
                  </pre>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onKill(r.sessionId)}
                  disabled={killingPid === r.sessionId}
                  title="KILL session"
                  className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                >
                  <Skull className="size-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}

function sessionPriority(r: ActivityRow): number {
  if (r.blockingSessionId != null || r.status === "running") return 0;
  if (r.openTransactions > 0) return 1;
  return 2;
}

function waitClassTone(cls: string): string {
  switch (cls) {
    case "Lock":
      return "bg-red-500/10 text-red-500";
    case "IO":
      return "bg-amber-500/10 text-amber-500";
    case "CPU":
      return "bg-rose-500/10 text-rose-500";
    case "Latch":
    case "Memory":
    case "Parallelism":
      return "bg-blue-500/10 text-blue-500";
    case "Network":
      return "bg-indigo-500/10 text-indigo-500";
    case "Running":
      return "bg-emerald-500/10 text-emerald-500";
    case "Idle":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// ─── Databases panel ─────────────────────────────────────────────────────

function DatabasesPanel({
  overview,
  connectionId,
  currentDatabase,
}: {
  overview: Overview | null;
  connectionId: string;
  currentDatabase: string;
}) {
  const max = overview?.topDatabases[0]?.sizeBytes ?? 0;
  return (
    <PanelCard
      title={
        overview
          ? `Databases · ${overview.databaseCount}`
          : "Databases"
      }
      icon={<Database className="size-3.5 text-rose-500" />}
      sub={overview ? `top ${overview.topDatabases.length} by size` : ""}
      action={
        <Link
          href={`/sqlserver/${connectionId}/databases`}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          All ›
        </Link>
      }
    >
      {overview === null ? (
        <Skeleton className="h-32" />
      ) : overview.topDatabases.length === 0 ? (
        <EmptyRow>No databases on this instance.</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {overview.topDatabases.map((d) => {
            const pct = max > 0 ? Math.max(2, (d.sizeBytes / max) * 100) : 0;
            const offline = d.state !== "ONLINE";
            const isCurrent = d.name === currentDatabase;
            return (
              <li key={d.name}>
                <Link
                  href={`/sqlserver/${connectionId}/databases/${encodeURIComponent(d.name)}/tables`}
                  className="block group"
                >
                  <div className="flex items-center justify-between text-[11.5px] mb-1 gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={cn(
                          "font-mono truncate",
                          isCurrent
                            ? "text-foreground font-medium"
                            : "text-foreground/85 group-hover:text-foreground",
                        )}
                      >
                        {d.name}
                      </span>
                      {d.isSystem ? (
                        <Badge
                          variant="outline"
                          className="text-[9px] font-mono uppercase tracking-wider border-border/60 text-muted-foreground py-0"
                        >
                          system
                        </Badge>
                      ) : null}
                      {offline ? (
                        <Badge
                          variant="outline"
                          className="text-[9px] font-mono uppercase tracking-wider border-amber-500/40 text-amber-500 py-0"
                        >
                          {d.state}
                        </Badge>
                      ) : null}
                      <span className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1">
                        <TableIcon className="size-3" />
                        {d.tableCount}
                      </span>
                    </span>
                    <span className="tabular-nums font-mono text-muted-foreground shrink-0">
                      {formatBytes(d.sizeBytes)}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-red-500 to-rose-600 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}

// ─── Top waits panel ─────────────────────────────────────────────────────

function TopWaitsPanel({ waits }: { waits: WaitBucket[] | null }) {
  const total = waits?.reduce((s, w) => s + w.waitSeconds, 0) ?? 0;
  return (
    <PanelCard
      title="Top waits"
      icon={<Waves className="size-3.5 text-rose-500" />}
      sub="cumulative · since last clear"
    >
      {waits === null ? (
        <Skeleton className="h-24" />
      ) : waits.length === 0 ? (
        <EmptyRow>No notable waits.</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {waits.map((w) => {
            const pct = total > 0 ? (w.waitSeconds / total) * 100 : 0;
            return (
              <li key={w.bucket}>
                <div className="flex items-center justify-between text-[11.5px] mb-1">
                  <span className="font-mono">{w.bucket}</span>
                  <span className="tabular-nums font-mono text-muted-foreground">
                    {formatDuration(w.waitSeconds)}
                    <span className="ml-1 text-[10px]">
                      · {pct >= 1 ? pct.toFixed(0) : "<1"}%
                    </span>
                  </span>
                </div>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rose-500 to-red-600 transition-all"
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}

// ─── Shared panel chrome ─────────────────────────────────────────────────

function PanelCard({
  title,
  icon,
  sub,
  action,
  tone,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  sub?: string;
  action?: React.ReactNode;
  tone?: "alert";
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border bg-card overflow-hidden",
        tone === "alert"
          ? "border-red-500/40 shadow-[0_0_0_1px_rgba(239,68,68,0.08)]"
          : "border-border/60",
      )}
    >
      <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h3 className="text-[13px] font-semibold tracking-tight truncate">
            {title}
          </h3>
          {sub ? (
            <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground truncate">
              · {sub}
            </span>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-3.5">{children}</div>
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-3 text-center text-[12px] text-muted-foreground inline-flex w-full items-center justify-center gap-1.5">
      <SquareTerminal className="size-3.5" />
      {children}
    </div>
  );
}

