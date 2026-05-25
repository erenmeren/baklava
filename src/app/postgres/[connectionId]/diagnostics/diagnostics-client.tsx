"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  Database,
  Disc3,
  HardDrive,
  Loader2,
  Snowflake,
  Waypoints,
} from "lucide-react";

interface DatabaseAge {
  name: string;
  age: number;
  pctUsed: number;
}

interface ReplicationSlot {
  name: string;
  type: string;
  active: boolean;
  database: string | null;
  walRetainedBytes: number | null;
  walRetainedMb: number;
  restartLsn: string | null;
  confirmedFlushLsn: string | null;
}

interface ReplicationPeer {
  applicationName: string;
  clientAddr: string | null;
  state: string;
  syncState: string;
  lagBytes: number | null;
  lagSeconds: number | null;
}

interface DiagnosticsSnapshot {
  sampledAt: number;
  checkpoints: {
    timed: number;
    requested: number;
    writeTimeMs: number;
    syncTimeMs: number;
    buffersCheckpoint: number;
    buffersClean: number;
    buffersBackend: number;
  };
  wal: {
    walRecords: number | null;
    walBytes: number | null;
    walWriteTimeMs: number | null;
    walSyncTimeMs: number | null;
    currentLsn: string | null;
    sinceStartBytes: number | null;
  };
  xidWraparound: {
    autovacuumFreezeMaxAge: number;
    databases: DatabaseAge[];
  };
  replication: {
    isPrimary: boolean;
    slots: ReplicationSlot[];
    peers: ReplicationPeer[];
  };
  autovacuum: {
    active: Array<{
      pid: number;
      database: string | null;
      relation: string | null;
      phase: string | null;
      queryStart: string | null;
      state: string | null;
    }>;
    deadTuples: Array<{
      schema: string;
      table: string;
      liveTuples: number;
      deadTuples: number;
      pctDead: number;
      lastVacuum: string | null;
      lastAutovacuum: string | null;
    }>;
  };
}

interface Props {
  connectionId: string;
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatLag(seconds: number | null): string {
  if (seconds == null) return "—";
  const abs = Math.abs(seconds);
  if (abs < 1) return `${Math.round(abs * 1000)} ms`;
  if (abs < 60) return `${abs.toFixed(1)} s`;
  return `${Math.floor(abs / 60)}m ${Math.floor(abs % 60)}s`;
}

export function DiagnosticsClient({ connectionId }: Props) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/postgres/${connectionId}/diagnostics`, {
        cache: "no-store",
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed");
      setSnapshot(data as DiagnosticsSnapshot);
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const worstXid = snapshot?.xidWraparound.databases[0];
  const xidTone = (pct: number) =>
    pct > 75 ? "rose" : pct > 50 ? "amber" : "emerald";

  const requestedCheckpointPct = snapshot
    ? snapshot.checkpoints.timed + snapshot.checkpoints.requested === 0
      ? 0
      : (snapshot.checkpoints.requested /
          (snapshot.checkpoints.timed + snapshot.checkpoints.requested)) *
        100
    : 0;

  return (
    <WorkspacePage
      title="Diagnostics"
      description="WAL throughput, checkpoint pressure, XID horizons, replication, and autovacuum activity — server-wide."
      actions={
        <RefreshButton onClick={load} loading={loading} />
      }
    >
      {error ? (
        <div className="mx-6 mb-4 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-500">
          {error}
        </div>
      ) : null}

      {snapshot ? (
        <div className="px-6 pb-10 space-y-6">
          {/* Top KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              icon={<HardDrive className="size-3.5" />}
              label="WAL written"
              value={formatBytes(snapshot.wal.walBytes)}
              sub={
                snapshot.wal.walRecords != null
                  ? `${formatCount(snapshot.wal.walRecords)} records`
                  : "pg_stat_wal unavailable"
              }
              tone={snapshot.wal.walBytes != null ? "neutral" : "muted"}
            />
            <KpiCard
              icon={<Disc3 className="size-3.5" />}
              label="Checkpoints"
              value={`${formatCount(
                snapshot.checkpoints.timed + snapshot.checkpoints.requested,
              )}`}
              sub={`${requestedCheckpointPct.toFixed(0)}% forced`}
              tone={
                requestedCheckpointPct > 50
                  ? "warn"
                  : requestedCheckpointPct > 20
                    ? "amber"
                    : "ok"
              }
            />
            <KpiCard
              icon={<Snowflake className="size-3.5" />}
              label="XID headroom"
              value={
                worstXid
                  ? `${(100 - worstXid.pctUsed).toFixed(0)}%`
                  : "—"
              }
              sub={
                worstXid
                  ? `worst: ${worstXid.name} (${worstXid.pctUsed.toFixed(0)}% used)`
                  : ""
              }
              tone={
                worstXid
                  ? worstXid.pctUsed > 75
                    ? "rose"
                    : worstXid.pctUsed > 50
                      ? "amber"
                      : "ok"
                  : "neutral"
              }
            />
            <KpiCard
              icon={<Waypoints className="size-3.5" />}
              label={snapshot.replication.isPrimary ? "Replicas" : "Recovering"}
              value={
                snapshot.replication.isPrimary
                  ? `${snapshot.replication.peers.length}`
                  : "standby"
              }
              sub={
                snapshot.replication.slots.length > 0
                  ? `${snapshot.replication.slots.length} slot${snapshot.replication.slots.length === 1 ? "" : "s"}`
                  : "no slots"
              }
              tone={
                snapshot.replication.slots.some(
                  (s) => (s.walRetainedMb ?? 0) > 100 && !s.active,
                )
                  ? "rose"
                  : "neutral"
              }
            />
          </div>

          {/* WAL & checkpoints panel */}
          <section className="rounded-lg border border-border/60 bg-card/40">
            <SectionHeader
              icon={<HardDrive className="size-3.5" />}
              title="Write-ahead log & checkpoints"
              hint="If 'forced' checkpoints dominate, raise max_wal_size."
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 px-4 py-4 text-sm">
              <Stat label="Current LSN" value={snapshot.wal.currentLsn ?? "in recovery"} mono />
              <Stat label="WAL write time" value={formatMs(snapshot.wal.walWriteTimeMs)} />
              <Stat label="WAL sync time" value={formatMs(snapshot.wal.walSyncTimeMs)} />
              <Stat label="WAL records" value={formatCount(snapshot.wal.walRecords)} />
              <Stat label="Checkpoints timed" value={formatCount(snapshot.checkpoints.timed)} />
              <Stat
                label="Checkpoints requested"
                value={formatCount(snapshot.checkpoints.requested)}
                tone={requestedCheckpointPct > 50 ? "warn" : undefined}
              />
              <Stat label="Buffers (checkpoint)" value={formatCount(snapshot.checkpoints.buffersCheckpoint)} />
              <Stat label="Buffers (backend)" value={formatCount(snapshot.checkpoints.buffersBackend)} />
            </div>
          </section>

          {/* XID horizons */}
          <section className="rounded-lg border border-border/60 bg-card/40">
            <SectionHeader
              icon={<Snowflake className="size-3.5" />}
              title="Transaction ID wraparound"
              hint={`autovacuum_freeze_max_age = ${formatCount(snapshot.xidWraparound.autovacuumFreezeMaxAge)}`}
            />
            <div className="px-4 py-3 space-y-2">
              {snapshot.xidWraparound.databases.length === 0 ? (
                <div className="text-sm text-muted-foreground">No databases reporting age.</div>
              ) : (
                snapshot.xidWraparound.databases.map((d) => {
                  const tone = xidTone(d.pctUsed);
                  return (
                    <div key={d.name} className="flex items-center gap-3 text-sm">
                      <div className="flex items-center gap-1.5 w-40 truncate">
                        <Database className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono truncate">{d.name}</span>
                      </div>
                      <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all",
                            tone === "rose" && "bg-rose-500",
                            tone === "amber" && "bg-amber-500",
                            tone === "emerald" && "bg-emerald-500",
                          )}
                          style={{ width: `${Math.min(100, d.pctUsed)}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs tabular-nums w-24 text-right text-muted-foreground">
                        {formatCount(d.age)}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-xs tabular-nums w-12 text-right",
                          tone === "rose" && "text-rose-500",
                          tone === "amber" && "text-amber-600",
                          tone === "emerald" && "text-emerald-600",
                        )}
                      >
                        {d.pctUsed.toFixed(0)}%
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Replication */}
          <section className="rounded-lg border border-border/60 bg-card/40">
            <SectionHeader
              icon={<Waypoints className="size-3.5" />}
              title="Replication"
              hint={
                snapshot.replication.isPrimary
                  ? "Primary"
                  : "Recovering / standby"
              }
            />
            <div className="px-4 py-3 space-y-4">
              <div>
                <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Slots
                </h4>
                {snapshot.replication.slots.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No replication slots configured.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {snapshot.replication.slots.map((s) => {
                      const danger =
                        !s.active && (s.walRetainedMb ?? 0) > 100;
                      return (
                        <div
                          key={s.name}
                          className={cn(
                            "flex items-center gap-3 text-sm font-mono px-2 py-1 rounded",
                            danger
                              ? "bg-rose-500/10 border border-rose-500/30"
                              : "bg-muted/30 border border-border/40",
                          )}
                        >
                          <span className="font-medium w-40 truncate">
                            {s.name}
                          </span>
                          <span className="text-xs text-muted-foreground w-20">
                            {s.type}
                          </span>
                          <span
                            className={cn(
                              "text-xs",
                              s.active ? "text-emerald-600" : "text-amber-600",
                            )}
                          >
                            {s.active ? "active" : "inactive"}
                          </span>
                          <span className="text-xs text-muted-foreground flex-1 truncate">
                            retained: {formatBytes(s.walRetainedBytes)}
                          </span>
                          {danger ? (
                            <AlertTriangle className="size-3.5 text-rose-500 shrink-0" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Connected standbys
                </h4>
                {snapshot.replication.peers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    None connected.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {snapshot.replication.peers.map((p, i) => (
                      <div
                        key={`${p.applicationName}-${i}`}
                        className="flex items-center gap-3 text-sm font-mono px-2 py-1 rounded bg-muted/30 border border-border/40"
                      >
                        <span className="w-40 truncate font-medium">
                          {p.applicationName || "(unnamed)"}
                        </span>
                        <span className="text-xs text-muted-foreground w-32 truncate">
                          {p.clientAddr ?? "—"}
                        </span>
                        <span className="text-xs text-muted-foreground w-20">
                          {p.state}
                        </span>
                        <span className="text-xs text-muted-foreground w-16">
                          {p.syncState}
                        </span>
                        <span className="text-xs text-muted-foreground flex-1">
                          lag: {formatBytes(p.lagBytes)} · {formatLag(p.lagSeconds)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Autovacuum */}
          <section className="rounded-lg border border-border/60 bg-card/40">
            <SectionHeader
              icon={<Activity className="size-3.5" />}
              title="Autovacuum"
              hint={
                snapshot.autovacuum.active.length > 0
                  ? `${snapshot.autovacuum.active.length} active`
                  : "idle"
              }
            />
            <div className="px-4 py-3 space-y-4">
              {snapshot.autovacuum.active.length > 0 ? (
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    In progress
                  </h4>
                  <div className="space-y-1.5">
                    {snapshot.autovacuum.active.map((a) => (
                      <div
                        key={a.pid}
                        className="flex items-center gap-3 text-sm font-mono px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30"
                      >
                        <span className="w-16 text-amber-600">
                          {a.pid}
                        </span>
                        <span className="w-40 truncate text-muted-foreground">
                          {a.database ?? "—"}
                        </span>
                        <span className="flex-1 truncate">
                          {a.relation ?? "(unknown)"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {a.phase ?? a.state ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Top dead-tuple tables
                </h4>
                {snapshot.autovacuum.deadTuples.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No dead tuples reported.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {snapshot.autovacuum.deadTuples.map((t) => (
                      <div
                        key={`${t.schema}.${t.table}`}
                        className="flex items-center gap-3 text-sm font-mono"
                      >
                        <span className="flex-1 truncate">
                          {t.schema}.{t.table}
                        </span>
                        <span className="w-20 text-right text-muted-foreground tabular-nums">
                          {formatCount(t.deadTuples)}
                        </span>
                        <span
                          className={cn(
                            "w-12 text-right tabular-nums",
                            t.pctDead > 20
                              ? "text-rose-500"
                              : t.pctDead > 5
                                ? "text-amber-600"
                                : "text-muted-foreground",
                          )}
                        >
                          {t.pctDead.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="text-[10px] font-mono text-muted-foreground">
            Sampled at {new Date(snapshot.sampledAt).toLocaleString()}
          </div>
        </div>
      ) : loading ? (
        <div className="px-6 py-12 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Sampling server…
        </div>
      ) : null}
    </WorkspacePage>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "rose" | "amber" | "warn" | "ok" | "neutral" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card/40 px-3 py-2.5",
        tone === "rose" && "border-rose-500/30 bg-rose-500/5",
        tone === "amber" && "border-amber-500/30 bg-amber-500/5",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/5",
        (tone === "neutral" || tone === "muted") && "border-border/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-medium font-mono mt-1">{value}</div>
      {sub ? (
        <div className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      {hint ? (
        <div className="text-[10px] font-mono text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "warn";
}) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          mono && "font-mono",
          tone === "warn" && "text-amber-600",
          "text-base mt-0.5 truncate",
        )}
      >
        {value}
      </div>
    </div>
  );
}

