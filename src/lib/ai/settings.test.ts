import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

async function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-ai-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.aiSettings")] = undefined;
  vi.resetModules();
  const mod = await import("./settings");
  return { mod, dir };
}

describe("ai settings store", () => {
  beforeEach(() => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.aiSettings")];
  });

  it("returns empty defaults when nothing is saved", async () => {
    const { mod } = await freshStore();
    const s = mod.getSettings();
    expect(s.activeProvider).toBeNull();
    expect(s.stepCap).toBe(12);
  });

  it("persists a provider key and reloads it from disk", async () => {
    const { mod, dir } = await freshStore();
    mod.saveProvider("anthropic", { apiKey: "sk-secret", model: "claude-sonnet-4-6" });
    mod.setActiveProvider("anthropic");
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "ai.json"), "utf8"));
    expect(raw.providers.anthropic.apiKey).toBe("sk-secret");
    expect(raw.activeProvider).toBe("anthropic");
  });

  it("redacts the api key in the public view", async () => {
    const { mod } = await freshStore();
    mod.saveProvider("anthropic", { apiKey: "sk-secret", model: "claude-sonnet-4-6" });
    const pub = mod.publicSettings();
    expect(pub.providers.anthropic?.apiKey).not.toBe("sk-secret");
    expect(pub.providers.anthropic?.apiKey).toMatch(/^•+$/);
  });

  it("keeps the existing key when a save omits it (blank = keep)", async () => {
    const { mod } = await freshStore();
    mod.saveProvider("anthropic", { apiKey: "sk-secret", model: "claude-sonnet-4-6" });
    mod.saveProvider("anthropic", { apiKey: "", model: "claude-opus-4-8" });
    expect(mod.getSettings().providers.anthropic?.apiKey).toBe("sk-secret");
    expect(mod.getSettings().providers.anthropic?.model).toBe("claude-opus-4-8");
  });
});
