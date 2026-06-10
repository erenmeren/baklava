import "server-only";
import { formatError } from "@/lib/errors";
import type {
  ConnectionRecord,
  PostgresConfig,
  RedisConfig,
} from "./types";

export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthMetric {
  label: string;
  value: string;
  hint?: string;
}

export interface HealthSnapshot {
  status: HealthStatus;
  latencyMs: number;
  summary: string;
  metrics: HealthMetric[];
  primary?: { label: string; value: number; max?: number; unit?: string };
  error?: string;
}

interface ProbeBody {
  summary: string;
  metrics: HealthMetric[];
  primary?: HealthSnapshot["primary"];
  warn?: boolean;
}

export const PROBE_TIMEOUT_MS = 6000;
export const DEGRADED_LATENCY_MS = 500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`health probe timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export async function probeHealth(conn: ConnectionRecord): Promise<HealthSnapshot> {
  const started = performance.now();
  try {
    const body = await withTimeout(probeFor(conn), PROBE_TIMEOUT_MS);
    const latencyMs = Math.round(performance.now() - started);
    const status: HealthStatus =
      body.warn || latencyMs > DEGRADED_LATENCY_MS ? "degraded" : "ok";
    return {
      status, latencyMs,
      summary: body.summary, metrics: body.metrics, primary: body.primary,
    };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - started),
      summary: "Unreachable",
      metrics: [],
      error: formatError(err),
    };
  }
}

function probeFor(conn: ConnectionRecord): Promise<ProbeBody> {
  switch (conn.tech) {
    case "postgres": return postgresBody(conn);
    case "redis": return redisBody(conn);
    default: return reachabilityOnly(conn);
  }
}

async function reachabilityOnly(_conn: ConnectionRecord): Promise<ProbeBody> {
  return { summary: "Reachable", metrics: [] };
}

// ── Postgres ────────────────────────────────────────────────────────────────
import { getServerOverview as pgOverview } from "./postgres";
async function postgresBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const o = await pgOverview(conn.config as PostgresConfig);
  const pct = o.maxConnections > 0 ? o.activeConnections / o.maxConnections : 0;
  return {
    summary: `${plural(o.databases.length, "database")} · ${formatBytes(o.totalDatabasesSize)}`,
    metrics: [
      { label: "Connections", value: `${o.activeConnections}/${o.maxConnections}` },
      { label: "Size", value: formatBytes(o.totalDatabasesSize) },
    ],
    primary: { label: "Connections", value: o.activeConnections, max: o.maxConnections },
    warn: pct > 0.8,
  };
}

// ── Redis ───────────────────────────────────────────────────────────────────
import { info as redisInfo } from "./redis";
async function redisBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const s = await redisInfo(conn.id, conn.config as RedisConfig);
  const used = Number(s.memory?.used_memory ?? 0);
  const max = Number(s.memory?.maxmemory ?? 0);
  const ops = Number(s.stats?.instantaneous_ops_per_sec ?? 0);
  const clients = Number(s.clients?.connected_clients ?? 0);
  const pct = max > 0 ? used / max : 0;
  return {
    summary: `${ops.toLocaleString()} ops/s · ${plural(clients, "client")}`,
    metrics: [
      { label: "Memory", value: max > 0 ? `${formatBytes(used)}/${formatBytes(max)}` : formatBytes(used) },
      { label: "Ops/sec", value: ops.toLocaleString() },
    ],
    primary: max > 0 ? { label: "Memory", value: used, max } : { label: "Ops/sec", value: ops },
    warn: max > 0 && pct > 0.85,
  };
}
