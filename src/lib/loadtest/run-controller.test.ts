import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fresh(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  const [store, controller] = await Promise.all([import("./store"), import("./run-controller")]);
  return { store, controller };
}

const CONFIG = {
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", method: "GET" as const, path: "/items" }],
  auth: { type: "bearer" as const, token: "tok" },
  profile: { type: "constant" as const, vus: 1, duration: "1s" },
};

function fakeResult(passed: boolean) {
  return {
    name: "x",
    passed,
    latency: { avg: 1, min: 1, p50: 1, max: 1, p90: 1, p95: 2, p99: 3 },
    totalRequests: 10,
    rps: 5,
    errorRate: 0,
    vusMax: 1,
    dataSent: 1,
    dataReceived: 1,
    requests: [],
    thresholds: [],
  };
}

describe("executeRun", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-run-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("runs, streams progress+result, and persists status from passed", async () => {
    const { store, controller } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    const events: string[] = [];
    const runner = async (_config: unknown, opts: { onProgress?: (p: { line: string }) => void }) => {
      opts.onProgress?.({ line: "running 1/1" });
      return fakeResult(true);
    };
    const run = await controller.executeRun(
      test,
      {
        onProgress: (l) => events.push(`p:${l}`),
        onResult: () => events.push("result"),
        onError: () => events.push("error"),
      },
      { runner },
    );
    expect(run.status).toBe("passed");
    expect(events).toEqual(["p:running 1/1", "result"]);
    expect(store.getRun(test.id, run.id)?.result?.rps).toBe(5);
  });

  it("persists status 'failed' when result.passed is false", async () => {
    const { store, controller } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    const run = await controller.executeRun(
      test,
      { onProgress: () => {}, onResult: () => {}, onError: () => {} },
      { runner: async () => fakeResult(false) },
    );
    expect(run.status).toBe("failed");
  });

  it("emits error and persists 'error' when the runner throws", async () => {
    const { store, controller } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    let errMsg = "";
    const run = await controller.executeRun(
      test,
      { onProgress: () => {}, onResult: () => {}, onError: (m) => (errMsg = m) },
      {
        runner: async () => {
          throw new Error("docker down");
        },
      },
    );
    expect(run.status).toBe("error");
    expect(errMsg).toMatch(/docker down/);
    expect(store.getRun(test.id, run.id)?.error).toMatch(/docker down/);
  });

  it("persists 'cancelled' when the signal is aborted", async () => {
    const { store, controller } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    const ac = new AbortController();
    ac.abort();
    const run = await controller.executeRun(
      test,
      { onProgress: () => {}, onResult: () => {}, onError: () => {} },
      {
        signal: ac.signal,
        runner: async () => {
          throw new Error("aborted");
        },
      },
    );
    expect(run.status).toBe("cancelled");
  });
});
