import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-lt-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_MASTER_KEY = "unit-test-master-key";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.masterKeyMaterial")];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_MASTER_KEY;
  delete process.env.BAKLAVA_DATA_DIR;
});

describe("loadtest store encryption", () => {
  it("persists bearer tokens encrypted", async () => {
    const store = await import("./store");
    store.saveLoadTest("user-enc", {
      name: "t",
      config: {
        target: { baseUrl: "http://example.com" },
        requests: [{ name: "r", method: "GET", path: "/" }],
        auth: { type: "bearer", token: "super-secret-token" },
        profile: { type: "constant", vus: 1, duration: "1s" },
        thresholds: undefined,
      },
    });
    const onDisk = fs.readFileSync(path.join(dir, "loadtests.json"), "utf8");
    expect(onDisk).not.toContain("super-secret-token");
    expect(onDisk).toContain("baklava-enc");

    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
    const store2 = await import("./store");
    expect(store2.listLoadTests("user-enc")[0].name).toBe("t");
  });
});
