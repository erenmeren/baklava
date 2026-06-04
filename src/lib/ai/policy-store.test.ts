import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-pol-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.aiPolicies")];
  vi.resetModules();
  const mod = await import("./policy-store");
  return { mod, dir };
}

describe("policy store", () => {
  it("returns DEFAULT_POLICY for an unknown connection", async () => {
    const { mod } = await fresh();
    expect(mod.getPolicy("nope").mode).toBe("confirm");
    expect(mod.getPolicy("nope").write).toBe(false);
  });

  it("persists and reloads a policy from disk", async () => {
    const { mod, dir } = await fresh();
    mod.setPolicy("conn1", { mode: "autonomous", read: true, write: true, destructive: false });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "ai-policies.json"), "utf8"));
    expect(raw.conn1.write).toBe(true);
    expect(mod.getPolicy("conn1").mode).toBe("autonomous");
  });
});
