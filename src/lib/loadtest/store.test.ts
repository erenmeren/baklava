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

const ALICE = "user-alice";
const BOB = "user-bob";

describe("loadtest store", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-store-"));
    process.env.BAKLAVA_MASTER_KEY = "unit-test-master-key";
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.masterKeyMaterial")];
  });
  afterEach(() => {
    delete process.env.BAKLAVA_MASTER_KEY;
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.masterKeyMaterial")];
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("saves, persists to a 0600 file, and reloads", async () => {
    const s1 = await freshStore(dataDir);
    const saved = s1.saveLoadTest(ALICE, { name: "T1", config: CONFIG });
    expect(saved.id).toBeTruthy();
    expect(saved.ownerId).toBe(ALICE);
    expect(saved.runs).toEqual([]);
    const file = join(dataDir, "loadtests.json");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const s2 = await freshStore(dataDir);
    const reloaded = s2.getLoadTest(saved.id, ALICE);
    expect(reloaded?.name).toBe("T1");
    expect(reloaded?.ownerId).toBe(ALICE);
    expect(reloaded?.config.auth).toEqual({ type: "bearer", token: "super-secret-token" });
  });

  it("redacts secrets in the public view", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
    const pub = s.publicLoadTest(s.getLoadTest(saved.id, ALICE)!);
    expect(pub.config.auth.type).toBe("bearer");
    expect((pub.config.auth as { token: string }).token).not.toBe("super-secret-token");
    expect((pub.config.auth as { token: string }).token.length).toBeGreaterThan(0);
  });

  it("preserves a secret on update when the field is blank", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
    const updated = s.updateLoadTest(saved.id, ALICE, {
      config: { ...CONFIG, auth: { type: "bearer", token: "" } },
    });
    expect(updated?.config.auth).toEqual({ type: "bearer", token: "super-secret-token" });
  });

  it("replaces a secret on update when a new value is provided", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
    const updated = s.updateLoadTest(saved.id, ALICE, {
      config: { ...CONFIG, auth: { type: "bearer", token: "new-token" } },
    });
    expect(updated?.config.auth).toEqual({ type: "bearer", token: "new-token" });
  });

  it("appends runs, caps history at 500, and reports newest first", { timeout: 30_000 }, async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
    let last;
    for (let i = 0; i < 505; i++) {
      last = s.appendRun(saved.id, ALICE, { startedAt: 1000 + i, status: "passed" });
    }
    const runs = s.listRuns(saved.id, ALICE);
    expect(runs).toHaveLength(500);
    expect(runs[0].id).toBe(last!.id);
  });

  it("updateRun patches status/result and getRun returns it", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
    const run = s.appendRun(saved.id, ALICE, { startedAt: 1, status: "running" });
    const done = s.updateRun(saved.id, ALICE, run.id, { status: "passed", finishedAt: 2 });
    expect(done?.status).toBe("passed");
    expect(s.getRun(saved.id, ALICE, run.id)?.finishedAt).toBe(2);
  });

  it("reconciles a 'running' run to 'error' after a process restart", async () => {
    const s1 = await freshStore(dataDir);
    const saved = s1.saveLoadTest(ALICE, { name: "T", config: CONFIG });
    s1.appendRun(saved.id, ALICE, { startedAt: 1, status: "running" });
    const s2 = await freshStore(dataDir);
    expect(s2.listRuns(saved.id, ALICE)[0].status).toBe("error");
  });

  it("deletes a test", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
    expect(s.deleteLoadTest(saved.id, ALICE)).toBe(true);
    expect(s.getLoadTest(saved.id, ALICE)).toBeUndefined();
  });

  describe("ownership scoping", () => {
    it("listLoadTests returns only the viewer's tests", async () => {
      const s = await freshStore(dataDir);
      const a = s.saveLoadTest(ALICE, { name: "alice-test", config: CONFIG });
      s.saveLoadTest(BOB, { name: "bob-test", config: CONFIG });
      const aliceList = s.listLoadTests(ALICE);
      expect(aliceList).toHaveLength(1);
      expect(aliceList[0].id).toBe(a.id);
      expect(s.listLoadTests(BOB)).toHaveLength(1);
    });

    it("getLoadTest returns undefined for a non-owner", async () => {
      const s = await freshStore(dataDir);
      const a = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
      expect(s.getLoadTest(a.id, ALICE)?.id).toBe(a.id);
      expect(s.getLoadTest(a.id, BOB)).toBeUndefined();
    });

    it("ownsLoadTest is true only for the owner", async () => {
      const s = await freshStore(dataDir);
      const a = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
      expect(s.ownsLoadTest(a.id, ALICE)).toBe(true);
      expect(s.ownsLoadTest(a.id, BOB)).toBe(false);
      expect(s.ownsLoadTest("nope", ALICE)).toBe(false);
    });

    it("a non-owner cannot update or delete", async () => {
      const s = await freshStore(dataDir);
      const a = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
      expect(s.updateLoadTest(a.id, BOB, { name: "hacked" })).toBeUndefined();
      expect(s.getLoadTest(a.id, ALICE)?.name).toBe("T");
      expect(s.deleteLoadTest(a.id, BOB)).toBe(false);
      expect(s.getLoadTest(a.id, ALICE)?.id).toBe(a.id);
    });

    it("a non-owner cannot read or append runs", async () => {
      const s = await freshStore(dataDir);
      const a = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
      s.appendRun(a.id, ALICE, { startedAt: 1, status: "passed" });
      expect(s.listRuns(a.id, BOB)).toEqual([]);
      expect(() => s.appendRun(a.id, BOB, { startedAt: 2, status: "passed" })).toThrow();
      const aliceRun = s.listRuns(a.id, ALICE)[0];
      expect(s.getRun(a.id, BOB, aliceRun.id)).toBeUndefined();
      expect(s.updateRun(a.id, BOB, aliceRun.id, { status: "failed" })).toBeUndefined();
    });

    it("an empty viewer id never matches (unauthenticated)", async () => {
      const s = await freshStore(dataDir);
      const a = s.saveLoadTest(ALICE, { name: "T", config: CONFIG });
      expect(s.getLoadTest(a.id, "")).toBeUndefined();
      expect(s.listLoadTests("")).toEqual([]);
      expect(s.ownsLoadTest(a.id, "")).toBe(false);
    });

    it("legacy ownerless rows (ownerId '') are invisible to every real user", async () => {
      // Persist a row without ownerId, then reload through the store so the
      // normaliser runs.
      const s1 = await freshStore(dataDir);
      const saved = s1.saveLoadTest(ALICE, { name: "legacy", config: CONFIG });
      // Simulate a pre-ownership row by stripping ownerId on disk.
      const { readSecretFileSync, writeSecretFileSync } = await import(
        "@/lib/crypto/secret-file"
      );
      const file = join(dataDir, "loadtests.json");
      const raw = JSON.parse(readSecretFileSync(file)!) as {
        loadtests: { ownerId?: string }[];
      };
      delete raw.loadtests[0].ownerId;
      writeSecretFileSync(file, JSON.stringify(raw));

      const s2 = await freshStore(dataDir);
      expect(s2.getLoadTest(saved.id, ALICE)).toBeUndefined();
      expect(s2.listLoadTests(ALICE)).toEqual([]);
      // Normalised to "" — invisible, not crashing.
      expect(s2.ownsLoadTest(saved.id, ALICE)).toBe(false);
    });
  });
});
