import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const setNodeSchedulable = vi.fn(async () => {});
interface DrainResult {
  cordoned: boolean;
  evicted: number;
  failures: Array<{ pod: string; error: string }>;
}
const drainNode = vi.fn(
  async (): Promise<DrainResult> => ({ cordoned: true, evicted: 3, failures: [] }),
);
vi.mock("@/lib/connections/kubernetes", () => ({
  setNodeSchedulable: (...a: unknown[]) => setNodeSchedulable(...(a as [])),
  drainNode: (...a: unknown[]) => drainNode(...(a as [])),
}));

const ctx = (id: string, name = "worker-1") => ({ params: Promise.resolve({ id, name }) });
const req = (body: unknown) =>
  new NextRequest(
    new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }),
  );

describe("POST /api/kubernetes/[id]/nodes/[name]", () => {
  let dataDir: string;
  let route: typeof import("./[id]/nodes/[name]/route");
  let connectionId: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-k8s-node-"));
    process.env.BAKLAVA_DATA_DIR = dataDir;
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
    vi.resetModules();
    setNodeSchedulable.mockClear();
    drainNode.mockClear();
    const store = await import("@/lib/connections/store");
    connectionId = store.saveConnection({
      tech: "kubernetes",
      name: "prod",
      config: { source: "path" },
      status: "ok",
    }).id;
    route = await import("./[id]/nodes/[name]/route");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("cordons", async () => {
    const res = await route.POST(req({ action: "cordon" }), ctx(connectionId));
    expect(res.status).toBe(200);
    expect(setNodeSchedulable).toHaveBeenCalledWith(
      connectionId,
      expect.anything(),
      "worker-1",
      false,
    );
  });

  it("uncordons", async () => {
    await route.POST(req({ action: "uncordon" }), ctx(connectionId));
    expect(setNodeSchedulable).toHaveBeenCalledWith(
      connectionId,
      expect.anything(),
      "worker-1",
      true,
    );
  });

  it("drains and reports what it evicted", async () => {
    const res = await route.POST(req({ action: "drain" }), ctx(connectionId));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      cordoned: true,
      evicted: 3,
      failures: [],
    });
  });

  it("reports per-pod eviction refusals rather than failing the drain", async () => {
    drainNode.mockResolvedValueOnce({
      cordoned: true,
      evicted: 1,
      failures: [{ pod: "payments/api-0", error: "Cannot evict pod as it would violate a PDB" }],
    });
    const res = await route.POST(req({ action: "drain" }), ctx(connectionId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { failures: unknown[] };
    expect(body.failures).toHaveLength(1);
  });

  it("rejects an unknown action", async () => {
    const res = await route.POST(req({ action: "nuke" }), ctx(connectionId));
    expect(res.status).toBe(400);
    expect(setNodeSchedulable).not.toHaveBeenCalled();
    expect(drainNode).not.toHaveBeenCalled();
  });

  it("404s on an unknown connection", async () => {
    const res = await route.POST(req({ action: "cordon" }), ctx("nope"));
    expect(res.status).toBe(404);
    expect(setNodeSchedulable).not.toHaveBeenCalled();
  });

  it("reports a cluster failure as 502", async () => {
    setNodeSchedulable.mockRejectedValueOnce(
      Object.assign(new Error(""), { code: "ECONNREFUSED" }),
    );
    const res = await route.POST(req({ action: "cordon" }), ctx(connectionId));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("ECONNREFUSED");
  });
});
