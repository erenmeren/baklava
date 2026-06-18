import "server-only";
import net from "node:net";
import { formatError } from "@/lib/errors";
import type {
  ConnectionRecord,
  DockerConfig,
  KafkaConfig,
  KubernetesConfig,
  MongoConfig,
  MysqlConfig,
  PostgresConfig,
  QdrantConfig,
  RedisConfig,
  SqlServerConfig,
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

export interface ProbeBody {
  summary: string;
  metrics: HealthMetric[];
  primary?: HealthSnapshot["primary"];
  warn?: boolean;
}

export const PROBE_TIMEOUT_MS = 6000;
export const DEGRADED_LATENCY_MS = 500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`health probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
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

async function probeFor(conn: ConnectionRecord): Promise<ProbeBody> {
  const { techById } = await import("@/techs/registry");
  const health = techById.get(conn.tech)?.driver.health;
  return health ? ((await health(conn)) as ProbeBody) : reachabilityOnly(conn);
}

const PROTO_PORT: Record<string, number> = {
  "http:": 80, "https:": 443, "redis:": 6379, "mongodb:": 27017,
  "amqp:": 5672, "amqps:": 5671, "nats:": 4222, "bolt:": 7687, "neo4j:": 7687,
};

/**
 * Best-effort host/port extraction for techs that have no dedicated probe
 * (e.g. connections persisted by a larger build of the app). Covers the common
 * `{host, port}` shape, kafka-style `brokers: ["host:port"]`, and URL configs.
 */
export function endpointOf(config: unknown): { host: string; port: number } | null {
  const c = (config ?? {}) as Record<string, unknown>;
  if (typeof c.host === "string" && c.host && Number(c.port) > 0) {
    return { host: c.host, port: Number(c.port) };
  }
  // Array-of-endpoint fields: kafka `brokers`, ES `nodes`, NATS `servers`,
  // etcd `hosts`, etc. Each element is a "host:port" or a URL.
  for (const key of ["brokers", "nodes", "servers", "hosts", "endpoints"]) {
    const arr = c[key];
    if (Array.isArray(arr) && typeof arr[0] === "string") {
      const e = parseEndpoint(arr[0]);
      if (e) return e;
    }
  }
  // Single string URL/host:port fields.
  for (const key of ["url", "uri", "endpoint", "connectionString"]) {
    if (typeof c[key] === "string") {
      const e = parseEndpoint(c[key] as string);
      if (e) return e;
    }
  }
  return null;
}

/** Parse a "host:port" or a URL ("scheme://host[:port]") into host + port. */
function parseEndpoint(s: string): { host: string; port: number } | null {
  try {
    const u = new URL(s);
    const port = Number(u.port) || PROTO_PORT[u.protocol] || 0;
    if (u.hostname && port) return { host: u.hostname, port };
  } catch {
    /* not a URL — fall through to host:port */
  }
  const m = s.match(/^([^:/]+):(\d+)$/);
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

function tcpProbe(host: string, port: number, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const done = (err?: Error) => {
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(ms);
    socket.once("connect", () => done());
    socket.once("timeout", () => done(new Error(`connect timed out after ${ms}ms`)));
    socket.once("error", (e) => done(e));
    socket.connect(port, host);
  });
}

/**
 * Reachability for any tech without a richer probe: a real TCP connect to the
 * configured endpoint. Throwing (refused/timeout) surfaces as `down` upstream —
 * so this never reports a healthy status it didn't actually verify.
 */
async function reachabilityOnly(conn: ConnectionRecord): Promise<ProbeBody> {
  const ep = endpointOf(conn.config);
  if (!ep) return { summary: "No endpoint to probe", metrics: [] };
  await tcpProbe(ep.host, ep.port, PROBE_TIMEOUT_MS);
  return { summary: `Reachable · ${ep.host}:${ep.port}`, metrics: [] };
}

// ── Postgres ────────────────────────────────────────────────────────────────
import { getServerOverview as pgOverview } from "./postgres";
export async function postgresBody(conn: ConnectionRecord): Promise<ProbeBody> {
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
export async function redisBody(conn: ConnectionRecord): Promise<ProbeBody> {
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

// ── Docker ──────────────────────────────────────────────────────────────────
import { pingDocker, listContainers, readContainerStats } from "./docker";
export async function dockerBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const cfg = conn.config as DockerConfig;
  await pingDocker(cfg); // reachability
  const containers = await listContainers(cfg, true);
  const running = containers.filter((c) => c.state === "running");
  const stats = await Promise.allSettled(running.map((c) => readContainerStats(cfg, c.id)));
  let cpu = 0, mem = 0;
  for (const s of stats) {
    if (s.status === "fulfilled") { cpu += s.value.cpuPercent; mem += s.value.memoryUsage; }
  }
  return {
    summary: `${running.length}/${containers.length} container${containers.length === 1 ? "" : "s"} running`,
    metrics: [
      { label: "CPU", value: `${cpu.toFixed(0)}%` },
      { label: "Memory", value: formatBytes(mem) },
    ],
    primary: { label: "CPU", value: Math.round(cpu), unit: "%" },
  };
}

// ── Kafka ───────────────────────────────────────────────────────────────────
import { probeKafka, listConsumerGroups } from "./kafka";
export async function kafkaBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const cfg = conn.config as KafkaConfig;
  const [probe, groups] = await Promise.all([
    probeKafka(cfg),
    listConsumerGroups(cfg),
  ]);
  return {
    summary: `${plural(probe.topics.length, "topic")} · ${plural(probe.brokerCount, "broker")}`,
    metrics: [
      { label: "Topics", value: String(probe.topics.length) },
      { label: "Brokers", value: String(probe.brokerCount) },
      { label: "Groups", value: String(groups.length) },
    ],
    primary: { label: "Groups", value: groups.length },
  };
}

// ── MySQL ───────────────────────────────────────────────────────────────────
import { probeMysql } from "./mysql";
export async function mysqlBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const p = await probeMysql(conn.config as MysqlConfig);
  return { summary: `MySQL ${p.serverVersion.split("-")[0]}`, metrics: [] };
}

// ── SQL Server ──────────────────────────────────────────────────────────────
import { probeSqlServer } from "./sqlserver";
export async function sqlserverBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const p = await probeSqlServer(conn.config as SqlServerConfig);
  return {
    summary: plural(p.databaseCount, "database"),
    metrics: [{ label: "Databases", value: String(p.databaseCount) }],
    primary: { label: "Databases", value: p.databaseCount },
  };
}

// ── Mongo ───────────────────────────────────────────────────────────────────
import { probe as mongoProbe } from "./mongo";
export async function mongoBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const p = await mongoProbe(conn.id, conn.config as MongoConfig);
  return {
    summary: `${plural(p.databases, "database")} · ${formatBytes(p.totalSize)}`,
    metrics: [{ label: "Databases", value: String(p.databases) }],
    primary: { label: "Databases", value: p.databases },
  };
}

// ── Kubernetes ──────────────────────────────────────────────────────────────
import { probe as k8sProbe } from "./kubernetes";
export async function kubernetesBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const p = await k8sProbe(conn.id, conn.config as KubernetesConfig);
  return {
    summary: `${plural(p.nodeCount, "node")} · ${p.context}`,
    metrics: [{ label: "Nodes", value: String(p.nodeCount) }],
    primary: { label: "Nodes", value: p.nodeCount },
  };
}

// ── Qdrant ──────────────────────────────────────────────────────────────────
import { probeQdrant } from "./qdrant";
export async function qdrantBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const { collectionCount } = await probeQdrant(conn.config as QdrantConfig);
  return {
    summary: plural(collectionCount, "collection"),
    metrics: [{ label: "Collections", value: String(collectionCount) }],
    primary: { label: "Collections", value: collectionCount },
  };
}

// ── Blob (r2 / minio / s3) ──────────────────────────────────────────────────
import { blobTech } from "./blob-registry";
import { probe as s3Probe } from "./s3";
export async function blobBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const bt = blobTech(conn.tech);
  if (!bt) throw new Error(`no blob handler for ${conn.tech}`);
  const client = await bt.clientFor(conn.id, conn.config);
  const { buckets } = await s3Probe(client);
  return {
    summary: plural(buckets, "bucket"),
    metrics: [{ label: "Buckets", value: String(buckets) }],
    primary: { label: "Buckets", value: buckets },
  };
}
