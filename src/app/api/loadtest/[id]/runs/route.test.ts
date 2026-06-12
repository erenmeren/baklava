import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fresh(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  const [runsRoute, runRoute, store] = await Promise.all([
    import("./route"),
    import("./[runId]/route"),
    import("@/lib/loadtest/store"),
  ]);
  return { runsRoute, runRoute, store };
}

const CONFIG = {
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", method: "GET" as const, path: "/items" }],
  auth: { type: "none" as const },
  profile: { type: "constant" as const, vus: 1, duration: "1s" },
};

describe("loadtest runs read API", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-runs-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("GET runs returns newest-first summaries", async () => {
    const { runsRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    store.appendRun(test.id, { startedAt: 1, status: "passed" });
    const r2 = store.appendRun(test.id, { startedAt: 2, status: "failed" });

    const res = await runsRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: test.id }) });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { runs: { id: string; status: string }[] };
    expect(data.runs[0].id).toBe(r2.id);
    expect(data.runs).toHaveLength(2);
  });

  it("GET runs 404 when the test is missing", async () => {
    const { runsRoute } = await fresh(dataDir);
    const res = await runsRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("GET one run returns the full record; 404 when missing", async () => {
    const { runRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    const run = store.appendRun(test.id, { startedAt: 1, status: "passed" });

    const ok = await runRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id, runId: run.id }),
    });
    expect(ok.status).toBe(200);
    const miss = await runRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id, runId: "nope" }),
    });
    expect(miss.status).toBe(404);
  });
});
