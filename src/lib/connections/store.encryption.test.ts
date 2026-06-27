import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-conn-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_MASTER_KEY = "unit-test-master-key";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.masterKeyMaterial")];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_MASTER_KEY;
});

describe("connections store encryption", () => {
  it("persists encrypted and reloads", async () => {
    const store = await import("./store");
    store.saveConnection({
      tech: "postgres",
      name: "db",
      config: { host: "h", password: "hunter2" },
      status: "untested",
    });
    const onDisk = fs.readFileSync(path.join(dir, "connections.json"), "utf8");
    expect(onDisk).not.toContain("hunter2");
    expect(onDisk).toContain("baklava-enc");

    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
    const store2 = await import("./store");
    const all = store2.listConnections();
    expect(all.find((c) => c.name === "db")?.config).toMatchObject({ password: "hunter2" });
  });

  it("migrates a legacy plaintext file on next write", async () => {
    const file = path.join(dir, "connections.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, connections: [
        { id: "x1", tech: "postgres", name: "legacy", config: { password: "old" }, status: "untested", createdAt: 1 },
      ] }),
    );
    const store = await import("./store");
    expect(store.getConnection("x1")?.name).toBe("legacy");
    store.saveConnection({ tech: "postgres", name: "new", config: {}, status: "untested" });
    const onDisk = fs.readFileSync(file, "utf8");
    expect(onDisk).toContain("baklava-enc");
    expect(fs.existsSync(`${file}.pre-encryption.bak`)).toBe(true);
  });
});
