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

const ALICE = { id: "user-alice" };
const BOB = { id: "user-bob" };

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

async function actAs(user: { id: string } | null) {
  const mod = await import("@/lib/auth/current-user");
  (mod.getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue(user);
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
    vi.clearAllMocks();
  });

  it("GET runs returns newest-first summaries", async () => {
    const { runsRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest(ALICE.id, { name: "T", config: CONFIG });
    store.appendRun(test.id, ALICE.id, { startedAt: 1, status: "passed" });
    const r2 = store.appendRun(test.id, ALICE.id, { startedAt: 2, status: "failed" });

    await actAs(ALICE);
    const res = await runsRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { runs: { id: string; status: string }[] };
    expect(data.runs[0].id).toBe(r2.id);
    expect(data.runs).toHaveLength(2);
  });

  it("GET runs 404 when the test is missing", async () => {
    const { runsRoute } = await fresh(dataDir);
    await actAs(ALICE);
    const res = await runsRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET runs 404 for a non-owner (never leak another user's runs)", async () => {
    const { runsRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest(ALICE.id, { name: "T", config: CONFIG });
    store.appendRun(test.id, ALICE.id, { startedAt: 1, status: "passed" });

    await actAs(BOB);
    const res = await runsRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id }),
    });
    expect(res.status).toBe(404);
  });

  it("GET runs 401 when unauthenticated", async () => {
    const { runsRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest(ALICE.id, { name: "T", config: CONFIG });
    await actAs(null);
    const res = await runsRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id }),
    });
    expect(res.status).toBe(401);
  });

  it("GET one run returns the full record; 404 when missing", async () => {
    const { runRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest(ALICE.id, { name: "T", config: CONFIG });
    const run = store.appendRun(test.id, ALICE.id, { startedAt: 1, status: "passed" });

    await actAs(ALICE);
    const ok = await runRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id, runId: run.id }),
    });
    expect(ok.status).toBe(200);
    const miss = await runRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id, runId: "nope" }),
    });
    expect(miss.status).toBe(404);
  });

  it("GET one run 404 for a non-owner", async () => {
    const { runRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest(ALICE.id, { name: "T", config: CONFIG });
    const run = store.appendRun(test.id, ALICE.id, { startedAt: 1, status: "passed" });

    await actAs(BOB);
    const res = await runRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id, runId: run.id }),
    });
    expect(res.status).toBe(404);
  });
});
