import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-aisettings-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_MASTER_KEY = "unit-test-master-key";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.aiSettings")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.masterKeyMaterial")];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_MASTER_KEY;
  delete process.env.BAKLAVA_DATA_DIR;
});

describe("ai settings encryption", () => {
  it("persists the provider API key encrypted and reloads it", async () => {
    const settings = await import("./settings");
    settings.saveProvider("anthropic", { apiKey: "sk-super-secret-key", model: "claude-sonnet-4-6" });

    const onDisk = fs.readFileSync(path.join(dir, "ai.json"), "utf8");
    expect(onDisk).not.toContain("sk-super-secret-key");
    expect(onDisk).toContain("baklava-enc");

    // Fresh store instance reads it back.
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.aiSettings")];
    const settings2 = await import("./settings");
    expect(settings2.getSettings().providers.anthropic?.apiKey).toBe("sk-super-secret-key");
  });
});
