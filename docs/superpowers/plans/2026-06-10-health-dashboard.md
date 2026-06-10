# Health Dashboard ("Mission Control") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/dashboard` route that shows a live, polled status grid of every connection — reachability + headline metrics, with sparklines from poll history and view-only click-through to each workspace.

**Architecture:** A new `src/lib/connections/health.ts` exposes `probeHealth(conn)` which dispatches by `tech` to per-tech probes (reusing existing driver helpers), each wrapped in a 6s timeout and classified ok/degraded/down. A single dynamic route `/api/dashboard/[id]/health` returns one connection's snapshot. The client renders one `HealthCard` per connection; each card polls its own endpoint every 5s (visibility-gated, abort-on-unmount), keeps a ring buffer for a hand-rolled SVG sparkline, and reports status up to a summary bar.

**Tech Stack:** Next.js 16 App Router, TypeScript, vitest, shadcn `Card`/`Badge`, existing dockerode/kafkajs/pg/ioredis/mongodb/@aws-sdk drivers. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-09-health-dashboard-design.md`

---

## File Structure

**Create:**
- `src/lib/connections/health.ts` — `probeHealth(conn)` + types + per-tech probe bodies + helpers.
- `src/lib/connections/health.test.ts` — unit tests (mocked drivers).
- `src/app/api/dashboard/[id]/health/route.ts` — GET one snapshot.
- `src/app/api/dashboard/[id]/health/route.test.ts` — route tests.
- `src/app/dashboard/page.tsx` — server page + metadata.
- `src/app/dashboard/dashboard-client.tsx` — list fetch, summary bar, grid.
- `src/app/dashboard/health-card.tsx` — per-connection card + polling.
- `src/app/dashboard/sparkline.tsx` — dependency-free SVG sparkline.
- `src/components/dashboard-trigger.tsx` — header icon → `/dashboard`.

**Modify:**
- `src/app/layout.tsx` — add `<DashboardTrigger/>` to header controls.
- `src/components/command-palette/global-command-palette.tsx` — add a "Go to dashboard" command.

---

## Notable deviations from the spec (perf-driven, intentional)

These are baked into the tasks below; calling them out so the implementer doesn't "fix" them back:

1. **Kafka lag is NOT polled.** `listConsumerGroups` returns only group state; total lag needs a per-group `describeConsumerGroup` (the codebase deliberately avoids per-group offset resolution for perf). Doing that for every group every 5s would hammer the broker. Kafka's headline is **topics · brokers · groups** instead. Lag stays in the Kafka workspace.
2. **Docker CPU%/mem** is computed from one-shot `readContainerStats` per *running* container via `Promise.allSettled`. Fine for local/dev (the project's stated use case); the 6s timeout bounds pathological cases.

---

### Task 1: Health core + Postgres/Redis probes

**Files:**
- Create: `src/lib/connections/health.ts`
- Test: `src/lib/connections/health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connections/health.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./postgres", () => ({
  getServerOverview: vi.fn(),
}));
vi.mock("./redis", () => ({
  info: vi.fn(),
}));
// Drivers used by later tasks — stubbed so the module imports cleanly.
vi.mock("./docker", () => ({ pingDocker: vi.fn(), listContainers: vi.fn(), readContainerStats: vi.fn() }));
vi.mock("./kafka", () => ({ probeKafka: vi.fn(), listConsumerGroups: vi.fn() }));
vi.mock("./mysql", () => ({ probeMysql: vi.fn() }));
vi.mock("./sqlserver", () => ({ probeSqlServer: vi.fn() }));
vi.mock("./mongo", () => ({ probe: vi.fn() }));
vi.mock("./kubernetes", () => ({ probe: vi.fn() }));
vi.mock("./blob-registry", () => ({ blobTech: vi.fn() }));
vi.mock("./s3", () => ({ probe: vi.fn() }));

import * as pg from "./postgres";
import * as redis from "./redis";
import { probeHealth } from "./health";

const rec = (tech: string, config: unknown = {}) =>
  ({ id: "c1", tech, name: "Local", config }) as never;

describe("probeHealth — postgres", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies a healthy postgres as ok with a connections primary", async () => {
    vi.mocked(pg.getServerOverview).mockResolvedValue({
      activeConnections: 18, maxConnections: 100, totalDatabasesSize: 2_400_000_000,
      databases: [{}, {}], // length used for summary
    } as never);
    const snap = await probeHealth(rec("postgres"));
    expect(snap.status).toBe("ok");
    expect(snap.primary).toEqual({ label: "Connections", value: 18, max: 100 });
    expect(snap.metrics.find((m) => m.label === "Connections")?.value).toBe("18/100");
  });

  it("flags degraded when connections exceed 80% of max", async () => {
    vi.mocked(pg.getServerOverview).mockResolvedValue({
      activeConnections: 90, maxConnections: 100, totalDatabasesSize: 1, databases: [{}],
    } as never);
    const snap = await probeHealth(rec("postgres"));
    expect(snap.status).toBe("degraded");
  });

  it("returns down with an error when the probe throws", async () => {
    vi.mocked(pg.getServerOverview).mockRejectedValue(new Error("ECONNREFUSED"));
    const snap = await probeHealth(rec("postgres"));
    expect(snap.status).toBe("down");
    expect(snap.error).toBeTruthy();
    expect(snap.metrics).toEqual([]);
  });
});

describe("probeHealth — redis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flags degraded when memory exceeds 85% of maxmemory", async () => {
    vi.mocked(redis.info).mockResolvedValue({
      memory: { used_memory: "900", maxmemory: "1000" },
      stats: { instantaneous_ops_per_sec: "12000" },
      clients: { connected_clients: "12" },
    } as never);
    const snap = await probeHealth(rec("redis"));
    expect(snap.status).toBe("degraded");
    expect(snap.primary).toEqual({ label: "Memory", value: 900, max: 1000 });
  });

  it("stays ok and uses ops/sec as primary when maxmemory is unset", async () => {
    vi.mocked(redis.info).mockResolvedValue({
      memory: { used_memory: "900", maxmemory: "0" },
      stats: { instantaneous_ops_per_sec: "5" },
      clients: { connected_clients: "1" },
    } as never);
    const snap = await probeHealth(rec("redis"));
    expect(snap.status).toBe("ok");
    expect(snap.primary).toEqual({ label: "Ops/sec", value: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/connections/health.test.ts`
Expected: FAIL — `Cannot find module './health'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/connections/health.ts
import "server-only";
import { formatError } from "@/lib/errors";
import type {
  ConnectionRecord, DockerConfig, KafkaConfig, KubernetesConfig,
  MongoConfig, MysqlConfig, PostgresConfig, RedisConfig, SqlServerConfig,
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
  /** Drives the card's sparkline. */
  primary?: { label: string; value: number; max?: number; unit?: string };
  error?: string;
}

/** Per-tech probe output, before latency/status are applied. */
interface ProbeBody {
  summary: string;
  metrics: HealthMetric[];
  primary?: HealthSnapshot["primary"];
  /** Tech-specific degraded condition (e.g. PG conns > 80%). */
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
    // docker/kafka added in Task 2; the rest in Task 3.
    default: return reachabilityOnly(conn);
  }
}

/** Fallback until a tech gets a dedicated probe. Always "reachable" — replaced per tech. */
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/connections/health.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/health.ts src/lib/connections/health.test.ts
git commit -m "feat(health): core probeHealth + postgres/redis probes"
```

---

### Task 2: Docker + Kafka probes

**Files:**
- Modify: `src/lib/connections/health.ts`
- Test: `src/lib/connections/health.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `health.test.ts`:

```ts
import * as docker from "./docker";
import * as kafka from "./kafka";

describe("probeHealth — docker", () => {
  beforeEach(() => vi.clearAllMocks());
  it("aggregates cpu/mem across running containers", async () => {
    vi.mocked(docker.pingDocker).mockResolvedValue({} as never);
    vi.mocked(docker.listContainers).mockResolvedValue([
      { id: "a", state: "running" }, { id: "b", state: "exited" },
      { id: "c", state: "running" },
    ] as never);
    vi.mocked(docker.readContainerStats).mockImplementation(
      async (_cfg, id) => ({ cpuPercent: id === "a" ? 30 : 12, memoryUsage: 100 }) as never,
    );
    const snap = await probeHealth(rec("docker"));
    expect(snap.status).toBe("ok");
    expect(snap.primary).toEqual({ label: "CPU", value: 42, unit: "%" });
    expect(snap.summary).toBe("2/3 containers running");
  });
});

describe("probeHealth — kafka", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reports topics/brokers/groups and never queries lag", async () => {
    vi.mocked(kafka.probeKafka).mockResolvedValue({
      topics: [{}, {}, {}], brokerCount: 1,
    } as never);
    vi.mocked(kafka.listConsumerGroups).mockResolvedValue([{}, {}] as never);
    const snap = await probeHealth(rec("kafka"));
    expect(snap.status).toBe("ok");
    expect(snap.primary).toEqual({ label: "Groups", value: 2 });
    expect(snap.metrics.map((m) => m.label)).toEqual(["Topics", "Brokers", "Groups"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/connections/health.test.ts`
Expected: FAIL — docker/kafka cases hit `reachabilityOnly` (no primary/summary match).

- [ ] **Step 3: Implement**

In `health.ts`, extend the `switch` in `probeFor`:

```ts
    case "docker": return dockerBody(conn);
    case "kafka": return kafkaBody(conn);
```

Append the bodies:

```ts
// ── Docker ──────────────────────────────────────────────────────────────────
import { pingDocker, listContainers, readContainerStats } from "./docker";
async function dockerBody(conn: ConnectionRecord): Promise<ProbeBody> {
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
async function kafkaBody(conn: ConnectionRecord): Promise<ProbeBody> {
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/connections/health.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/health.ts src/lib/connections/health.test.ts
git commit -m "feat(health): docker + kafka probes"
```

---

### Task 3: Remaining techs (mysql, sqlserver, mongo, kubernetes, blob)

**Files:**
- Modify: `src/lib/connections/health.ts`
- Test: `src/lib/connections/health.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `health.test.ts`:

```ts
import * as mongo from "./mongo";
import * as k8s from "./kubernetes";
import * as blobRegistry from "./blob-registry";
import * as s3 from "./s3";

describe("probeHealth — remaining techs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mongo reports databases + size", async () => {
    vi.mocked(mongo.probe).mockResolvedValue({
      ok: true, version: "7.0", topology: "standalone", databases: 4, totalSize: 1024,
    } as never);
    const snap = await probeHealth(rec("mongo"));
    expect(snap.status).toBe("ok");
    expect(snap.summary).toBe("4 databases · 1.0 KB");
    expect(snap.primary).toEqual({ label: "Databases", value: 4 });
  });

  it("kubernetes reports node count", async () => {
    vi.mocked(k8s.probe).mockResolvedValue({
      context: "minikube", serverVersion: "v1.30", nodeCount: 3,
    } as never);
    const snap = await probeHealth(rec("kubernetes"));
    expect(snap.summary).toBe("3 nodes · minikube");
    expect(snap.primary).toEqual({ label: "Nodes", value: 3 });
  });

  it("blob (minio) reports bucket count via the registry client", async () => {
    const fakeClient = {};
    vi.mocked(blobRegistry.blobTech).mockReturnValue({
      clientFor: () => fakeClient,
    } as never);
    vi.mocked(s3.probe).mockResolvedValue({ buckets: 9 } as never);
    const snap = await probeHealth(rec("minio"));
    expect(snap.summary).toBe("9 buckets");
    expect(snap.primary).toEqual({ label: "Buckets", value: 9 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/connections/health.test.ts`
Expected: FAIL — mongo/kubernetes/minio fall through to `reachabilityOnly`.

- [ ] **Step 3: Implement**

Extend the `switch` in `probeFor`:

```ts
    case "mysql": return mysqlBody(conn);
    case "sqlserver": return sqlserverBody(conn);
    case "mongo": return mongoBody(conn);
    case "kubernetes": return kubernetesBody(conn);
    case "r2":
    case "minio":
    case "s3": return blobBody(conn);
```

Append the bodies:

```ts
// ── MySQL ───────────────────────────────────────────────────────────────────
import { probeMysql } from "./mysql";
async function mysqlBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const p = await probeMysql(conn.config as MysqlConfig);
  return { summary: `MySQL ${p.serverVersion.split("-")[0]}`, metrics: [] };
}

// ── SQL Server ──────────────────────────────────────────────────────────────
import { probeSqlServer } from "./sqlserver";
async function sqlserverBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const p = await probeSqlServer(conn.config as SqlServerConfig);
  return {
    summary: plural(p.databaseCount, "database"),
    metrics: [{ label: "Databases", value: String(p.databaseCount) }],
    primary: { label: "Databases", value: p.databaseCount },
  };
}

// ── Mongo ───────────────────────────────────────────────────────────────────
import { probe as mongoProbe } from "./mongo";
async function mongoBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const p = await mongoProbe(conn.id, conn.config as MongoConfig);
  return {
    summary: `${plural(p.databases, "database")} · ${formatBytes(p.totalSize)}`,
    metrics: [{ label: "Databases", value: String(p.databases) }],
    primary: { label: "Databases", value: p.databases },
  };
}

// ── Kubernetes ──────────────────────────────────────────────────────────────
import { probe as k8sProbe } from "./kubernetes";
async function kubernetesBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const p = await k8sProbe(conn.id, conn.config as KubernetesConfig);
  return {
    summary: `${plural(p.nodeCount, "node")} · ${p.context}`,
    metrics: [{ label: "Nodes", value: String(p.nodeCount) }],
    primary: { label: "Nodes", value: p.nodeCount },
  };
}

// ── Blob (r2 / minio / s3) ──────────────────────────────────────────────────
import { blobTech } from "./blob-registry";
import { probe as s3Probe } from "./s3";
async function blobBody(conn: ConnectionRecord): Promise<ProbeBody> {
  const bt = blobTech(conn.tech);
  if (!bt) throw new Error(`no blob handler for ${conn.tech}`);
  const client = bt.clientFor(conn.id, conn.config);
  const { buckets } = await s3Probe(client);
  return {
    summary: plural(buckets, "bucket"),
    metrics: [{ label: "Buckets", value: String(buckets) }],
    primary: { label: "Buckets", value: buckets },
  };
}
```

> Note: `reachabilityOnly` is now unreachable via the switch but is kept as the
> `default` safety net for any future `TechId`. Leave it.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/connections/health.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/connections/health.ts src/lib/connections/health.test.ts
git commit -m "feat(health): mysql/sqlserver/mongo/kubernetes/blob probes"
```

---

### Task 4: API route

**Files:**
- Create: `src/app/api/dashboard/[id]/health/route.ts`
- Test: `src/app/api/dashboard/[id]/health/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/dashboard/[id]/health/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/store", () => ({ getConnection: vi.fn() }));
vi.mock("@/lib/connections/health", () => ({ probeHealth: vi.fn() }));

import { getConnection } from "@/lib/connections/store";
import { probeHealth } from "@/lib/connections/health";
import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/dashboard/[id]/health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s when the connection is unknown", async () => {
    vi.mocked(getConnection).mockReturnValue(undefined);
    const res = await GET(new Request("http://x") as never, ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("returns the snapshot for a known connection", async () => {
    vi.mocked(getConnection).mockReturnValue({ id: "c1", tech: "postgres", config: {} } as never);
    vi.mocked(probeHealth).mockResolvedValue({ status: "ok", latencyMs: 9, summary: "x", metrics: [] } as never);
    const res = await GET(new Request("http://x") as never, ctx("c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", latencyMs: 9 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "src/app/api/dashboard/[id]/health/route.test.ts"`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement**

```ts
// src/app/api/dashboard/[id]/health/route.ts
import { NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import { probeHealth } from "@/lib/connections/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conn = getConnection(id);
  if (!conn) {
    return NextResponse.json({ error: "connection not found" }, { status: 404 });
  }
  const snapshot = await probeHealth(conn);
  return NextResponse.json(snapshot);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run "src/app/api/dashboard/[id]/health/route.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/dashboard/[id]/health/route.ts" "src/app/api/dashboard/[id]/health/route.test.ts"
git commit -m "feat(health): GET /api/dashboard/[id]/health route"
```

---

### Task 5: Sparkline component

**Files:**
- Create: `src/app/dashboard/sparkline.tsx`

- [ ] **Step 1: Implement (presentational, no test — verified visually in Task 9)**

```tsx
// src/app/dashboard/sparkline.tsx
"use client";

/** Dependency-free inline SVG sparkline from a numeric history. */
export function Sparkline({
  data,
  className,
  muted = false,
}: {
  data: number[];
  className?: string;
  muted?: boolean;
}) {
  const w = 96;
  const h = 24;
  if (data.length < 2) {
    return <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden />;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / span) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={muted ? 0.35 : 1}
      />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/sparkline.tsx
git commit -m "feat(dashboard): sparkline component"
```

---

### Task 6: HealthCard (polling + ring buffer)

**Files:**
- Create: `src/app/dashboard/health-card.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/dashboard/health-card.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { workspaceHref } from "@/lib/connections/first-page";
import type { ConnectionRecord } from "@/lib/connections/types";
import type { HealthSnapshot, HealthStatus } from "@/lib/connections/health";
import { Sparkline } from "./sparkline";

const POLL_MS = 5000;
const HISTORY = 30;

const DOT: Record<HealthStatus, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-destructive",
};
const RING: Record<HealthStatus, string> = {
  ok: "text-emerald-500",
  degraded: "text-amber-500",
  down: "text-destructive",
};

export function HealthCard({
  conn,
  onStatus,
}: {
  conn: ConnectionRecord;
  onStatus: (id: string, status: HealthStatus | null) => void;
}) {
  const router = useRouter();
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const history = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;

    const tick = async () => {
      if (document.hidden) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`/api/dashboard/${conn.id}/health`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!active) return;
        const data = (await res.json()) as HealthSnapshot;
        if (data.primary) {
          history.current = [...history.current, data.primary.value].slice(-HISTORY);
        }
        setSnap(data);
        onStatus(conn.id, data.status);
      } catch {
        if (!active) return;
        onStatus(conn.id, "down");
        setSnap((s) => (s ? { ...s, status: "down" } : s));
      }
    };

    tick();
    const interval = setInterval(tick, POLL_MS);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
      onStatus(conn.id, null);
    };
  }, [conn.id, onStatus]);

  const status = snap?.status;
  const down = status === "down";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => router.push(workspaceHref(conn.tech, conn.id))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(workspaceHref(conn.tech, conn.id));
        }
      }}
      className="cursor-pointer gap-3 p-4 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/icons/${conn.tech}.svg`} alt="" className="size-4 opacity-80 dark:invert" />
        <span className="truncate text-sm font-medium">{conn.name}</span>
        <span
          className={cn("ml-auto size-2 rounded-full", status ? DOT[status] : "bg-muted-foreground/40 animate-pulse")}
          title={status ?? "checking…"}
        />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {snap ? (down ? snap.error ?? "Unreachable" : snap.summary) : "Checking…"}
          </p>
          {snap?.metrics.length ? (
            <p className="mt-1 truncate font-mono text-xs tabular-nums">
              {snap.metrics.map((m) => `${m.label} ${m.value}`).join("  ·  ")}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Sparkline
            data={history.current}
            muted={down}
            className={cn("h-6 w-24", status ? RING[status] : "text-muted-foreground")}
          />
          {snap ? (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {down ? "—" : `${snap.latencyMs}ms`}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/health-card.tsx
git commit -m "feat(dashboard): HealthCard with polling + sparkline"
```

---

### Task 7: DashboardClient + page

**Files:**
- Create: `src/app/dashboard/dashboard-client.tsx`
- Create: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Implement the client**

```tsx
// src/app/dashboard/dashboard-client.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import type { ConnectionRecord } from "@/lib/connections/types";
import type { HealthStatus } from "@/lib/connections/health";
import { Card } from "@/components/ui/card";
import { HealthCard } from "./health-card";

export function DashboardClient() {
  const [conns, setConns] = useState<ConnectionRecord[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, HealthStatus>>({});

  useEffect(() => {
    fetch("/api/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { connections?: ConnectionRecord[] }) => setConns(d.connections ?? []))
      .catch(() => setConns([]));
  }, []);

  const onStatus = useCallback((id: string, status: HealthStatus | null) => {
    setStatuses((prev) => {
      if (status === null) {
        const { [id]: _gone, ...rest } = prev;
        return rest;
      }
      if (prev[id] === status) return prev;
      return { ...prev, [id]: status };
    });
  }, []);

  const values = Object.values(statuses);
  const healthy = values.filter((s) => s === "ok").length;
  const degraded = values.filter((s) => s === "degraded").length;
  const down = values.filter((s) => s === "down").length;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-10 pb-24">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutDashboard className="size-5 text-muted-foreground" />
            Dashboard
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Live health across every connection. Click a card to open its workspace.
          </p>
        </div>
        {conns?.length ? (
          <div className="flex shrink-0 items-center gap-4 font-mono text-xs tabular-nums">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />{healthy}</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" />{degraded}</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-destructive" />{down}</span>
          </div>
        ) : null}
      </header>

      {conns === null ? (
        <p className="text-sm text-muted-foreground">Loading connections…</p>
      ) : conns.length === 0 ? (
        <Card className="items-center p-12 text-center">
          <p className="text-sm font-medium">No connections yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one from the <Link href="/" className="underline underline-offset-4">home screen</Link> to see it here.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {conns.map((c) => (
            <HealthCard key={c.id} conn={c} onStatus={onStatus} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement the page**

```tsx
// src/app/dashboard/page.tsx
import type { Metadata } from "next";
import { DashboardClient } from "./dashboard-client";

export const metadata: Metadata = {
  title: "Dashboard · Baklava",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/dashboard-client.tsx src/app/dashboard/page.tsx
git commit -m "feat(dashboard): DashboardClient grid + summary bar + page"
```

---

### Task 8: Header trigger + ⌘K command

**Files:**
- Create: `src/components/dashboard-trigger.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/command-palette/global-command-palette.tsx`

- [ ] **Step 1: Create the trigger** (mirrors `settings-trigger.tsx`)

```tsx
// src/components/dashboard-trigger.tsx
"use client";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

export function DashboardTrigger() {
  return (
    <Link
      href="/dashboard"
      title="Dashboard"
      aria-label="Open dashboard"
      className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <LayoutDashboard className="size-4" />
    </Link>
  );
}
```

- [ ] **Step 2: Wire into the header**

In `src/app/layout.tsx`, add the import beside the other trigger imports:

```tsx
import { DashboardTrigger } from "@/components/dashboard-trigger";
```

Then add `<DashboardTrigger />` first in the controls cluster (before `<PaletteTrigger />`):

```tsx
                <div className="flex items-center gap-1.5 pl-2 shrink-0">
                  <DashboardTrigger />
                  <PaletteTrigger />
                  <AssistantTrigger />
                  <SettingsTrigger />
                  <ThemeToggle />
                </div>
```

- [ ] **Step 3: Add the ⌘K command**

In `src/components/command-palette/global-command-palette.tsx`, inside the
`<CommandGroup heading="Actions">` block, add as the first item (above
"New connection…"):

```tsx
          <CommandItem value="action dashboard" onSelect={() => go("/dashboard")}>
            <Icon name="LayoutDashboard" />
            <span>Go to dashboard</span>
          </CommandItem>
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/app/dashboard src/components/dashboard-trigger.tsx src/components/command-palette/global-command-palette.tsx src/app/layout.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard-trigger.tsx src/app/layout.tsx src/components/command-palette/global-command-palette.tsx
git commit -m "feat(dashboard): header trigger + ⌘K command"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run src/lib/connections/health.test.ts "src/app/api/dashboard/[id]/health/route.test.ts"`
Expected: PASS (12 tests).

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 3: Manual smoke test**

With `npm run dev` running and at least one connection configured:
1. Open `http://localhost:3000` → confirm the new dashboard icon appears in the header.
2. Click it → `/dashboard` renders a grid; each card shows a status dot that resolves from pulsing-grey to colored within ~5s.
3. Confirm the summary bar counts (● ▲ ✕) match the cards.
4. Leave it open ~15s → sparklines accumulate points; latency updates.
5. Click a card → lands on that connection's workspace (`workspaceHref`).
6. Press ⌘K → "Go to dashboard" is listed and navigates.
7. Switch to another browser tab for ~10s, return → polling resumed (no errors in console).

- [ ] **Step 4: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(dashboard): verification fixups"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** placement (`/dashboard` — Tasks 7/8), polling 5s visibility-gated (Task 6), tiered metrics (Tasks 1–3), reachability+latency for all (status/latency in `probeHealth`), view-only click-through (`workspaceHref`, Task 6), thresholds 6s/500ms/80%/85% (Task 1), summary bar (Task 7), empty state (Task 7), abort-on-unmount + visibility pause (Task 6), tests (Tasks 1–4). ✅
- **Deviations** (Kafka lag dropped, Docker stats cost) are documented above and reflected in tests.
- **Type consistency:** `HealthSnapshot` / `HealthMetric` / `HealthStatus` / `ProbeBody` defined once (Task 1), referenced unchanged in Tasks 2–4, 6, 7. `probeHealth`, `probeFor`, `workspaceHref`, `getConnection`, `blobTech`, `probeKafka`, `mongoProbe` all match their real signatures (verified against source).
- **No placeholders.** Every code step is complete.
