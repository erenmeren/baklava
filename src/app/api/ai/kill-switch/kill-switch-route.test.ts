import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _resetControlsForTests } from "@/lib/ai/kill-switch";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-ksr-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  _resetControlsForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
});

describe("kill-switch API", () => {
  it("GET reports off by default; POST flips it", async () => {
    const { GET, POST } = await import("./route");
    const g0 = await (await GET()).json();
    expect(g0).toEqual({ on: false });

    const p = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ on: true }) }));
    expect(await p.json()).toEqual({ on: true });

    const g1 = await (await GET()).json();
    expect(g1).toEqual({ on: true });
  });

  it("POST rejects a non-boolean", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ on: "yes" }) }));
    expect(res.status).toBe(400);
  });
});
