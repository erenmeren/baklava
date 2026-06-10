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
      databases: [{}, {}],
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
