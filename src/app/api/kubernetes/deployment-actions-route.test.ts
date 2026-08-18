import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const scaleDeployment = vi.fn(async () => {});
const restartDeployment = vi.fn(async () => {});
vi.mock("@/lib/connections/kubernetes", () => ({
  scaleDeployment: (...a: unknown[]) => scaleDeployment(...(a as [])),
  restartDeployment: (...a: unknown[]) => restartDeployment(...(a as [])),
}));

function ctx(id: string, ns = "payments", name = "api") {
  return { params: Promise.resolve({ id, ns, name }) };
}

function req(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }),
  );
}

describe("POST /api/kubernetes/[id]/deployments/[ns]/[name]", () => {
  let dataDir: string;
  let route: typeof import("./[id]/deployments/[ns]/[name]/route");
  let connectionId: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-k8s-deploy-"));
    process.env.BAKLAVA_DATA_DIR = dataDir;
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
    vi.resetModules();
    scaleDeployment.mockClear();
    restartDeployment.mockClear();
    const store = await import("@/lib/connections/store");
    connectionId = store.saveConnection({
      tech: "kubernetes",
      name: "prod-cluster",
      config: { source: "path" },
      status: "ok",
    }).id;
    route = await import("./[id]/deployments/[ns]/[name]/route");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("scales to the requested replica count", async () => {
    const res = await route.POST(req({ action: "scale", replicas: 5 }), ctx(connectionId));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(scaleDeployment).toHaveBeenCalledWith(
      connectionId,
      expect.anything(),
      "payments",
      "api",
      5,
    );
  });

  it("scales to zero", async () => {
    const res = await route.POST(req({ action: "scale", replicas: 0 }), ctx(connectionId));
    expect(res.status).toBe(200);
    expect(scaleDeployment).toHaveBeenCalledWith(
      connectionId,
      expect.anything(),
      "payments",
      "api",
      0,
    );
  });

  it("rejects a nonsense replica count with 400, before reaching the cluster", async () => {
    const res = await route.POST(req({ action: "scale", replicas: -2 }), ctx(connectionId));

    expect(res.status).toBe(400);
    expect(scaleDeployment).not.toHaveBeenCalled();
  });

  it("triggers a rollout restart", async () => {
    const res = await route.POST(req({ action: "restart" }), ctx(connectionId));

    expect(res.status).toBe(200);
    expect(restartDeployment).toHaveBeenCalledWith(
      connectionId,
      expect.anything(),
      "payments",
      "api",
    );
  });

  it("rejects an unknown action", async () => {
    const res = await route.POST(req({ action: "delete-everything" }), ctx(connectionId));

    expect(res.status).toBe(400);
    expect(scaleDeployment).not.toHaveBeenCalled();
    expect(restartDeployment).not.toHaveBeenCalled();
  });

  it("404s on an unknown connection", async () => {
    const res = await route.POST(req({ action: "restart" }), ctx("nope"));

    expect(res.status).toBe(404);
    expect(restartDeployment).not.toHaveBeenCalled();
  });

  it("reports a cluster failure as 502 with a formatted error", async () => {
    restartDeployment.mockRejectedValueOnce(
      Object.assign(new Error(""), { code: "ECONNREFUSED" }),
    );

    const res = await route.POST(req({ action: "restart" }), ctx(connectionId));

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("ECONNREFUSED");
  });
});
