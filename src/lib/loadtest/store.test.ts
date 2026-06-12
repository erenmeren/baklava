import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mirrors the connections store test harness: set BAKLAVA_DATA_DIR before
// import, clear the globalThis cache, reset modules, re-import fresh.
async function freshStore(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  return import("./store");
}

const CONFIG = {
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", method: "GET" as const, path: "/items" }],
  auth: { type: "bearer" as const, token: "super-secret-token" },
  profile: { type: "constant" as const, vus: 1, duration: "1s" },
};

describe("loadtest store", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-store-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("saves, persists to a 0600 file, and reloads", async () => {
    const s1 = await freshStore(dataDir);
    const saved = s1.saveLoadTest({ name: "T1", config: CONFIG });
    expect(saved.id).toBeTruthy();
    expect(saved.runs).toEqual([]);
    const file = join(dataDir, "loadtests.json");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const s2 = await freshStore(dataDir);
    const reloaded = s2.getLoadTest(saved.id);
    expect(reloaded?.name).toBe("T1");
    expect(reloaded?.config.auth).toEqual({ type: "bearer", token: "super-secret-token" });
  });

  it("redacts secrets in the public view", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    const pub = s.publicLoadTest(s.getLoadTest(saved.id)!);
    expect(pub.config.auth.type).toBe("bearer");
    expect((pub.config.auth as { token: string }).token).not.toBe("super-secret-token");
    expect((pub.config.auth as { token: string }).token.length).toBeGreaterThan(0);
  });

  it("preserves a secret on update when the field is blank", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    const updated = s.updateLoadTest(saved.id, {
      config: { ...CONFIG, auth: { type: "bearer", token: "" } },
    });
    expect(updated?.config.auth).toEqual({ type: "bearer", token: "super-secret-token" });
  });

  it("replaces a secret on update when a new value is provided", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    const updated = s.updateLoadTest(saved.id, {
      config: { ...CONFIG, auth: { type: "bearer", token: "new-token" } },
    });
    expect(updated?.config.auth).toEqual({ type: "bearer", token: "new-token" });
  });

  it("appends runs, caps history at 50, and reports newest first", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    let last;
    for (let i = 0; i < 55; i++) {
      last = s.appendRun(saved.id, { startedAt: 1000 + i, status: "passed" });
    }
    const runs = s.listRuns(saved.id);
    expect(runs).toHaveLength(50);
    expect(runs[0].id).toBe(last!.id);
  });

  it("updateRun patches status/result and getRun returns it", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    const run = s.appendRun(saved.id, { startedAt: 1, status: "running" });
    const done = s.updateRun(saved.id, run.id, { status: "passed", finishedAt: 2 });
    expect(done?.status).toBe("passed");
    expect(s.getRun(saved.id, run.id)?.finishedAt).toBe(2);
  });

  it("reconciles a 'running' run to 'error' after a process restart", async () => {
    const s1 = await freshStore(dataDir);
    const saved = s1.saveLoadTest({ name: "T", config: CONFIG });
    s1.appendRun(saved.id, { startedAt: 1, status: "running" });
    const s2 = await freshStore(dataDir);
    expect(s2.listRuns(saved.id)[0].status).toBe("error");
  });

  it("deletes a test", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    expect(s.deleteLoadTest(saved.id)).toBe(true);
    expect(s.getLoadTest(saved.id)).toBeUndefined();
  });
});
