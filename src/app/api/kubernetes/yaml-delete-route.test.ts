import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

// The driver talks to a live cluster; only the route's contract is under
// test here, so stub the three functions the route file imports.
const deleteResource = vi.fn(async () => {});
vi.mock("@/lib/connections/kubernetes", () => ({
  readResourceYaml: vi.fn(async () => "kind: Pod\n"),
  replaceResourceYaml: vi.fn(async () => {}),
  deleteResource: (...args: unknown[]) => deleteResource(...(args as [])),
}));

function ctx(id: string, kind: string, name: string) {
  return { params: Promise.resolve({ id, kind, name }) };
}

function req(url: string): NextRequest {
  // The handler reads `req.nextUrl.searchParams`, so this has to be a real
  // NextRequest rather than a plain Request.
  return new NextRequest(new Request(url, { method: "DELETE" }));
}

describe("DELETE /api/kubernetes/[id]/yaml/[kind]/[name]", () => {
  let dataDir: string;
  let route: typeof import("./[id]/yaml/[kind]/[name]/route");
  let connectionId: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-k8s-del-"));
    process.env.BAKLAVA_DATA_DIR = dataDir;
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
    vi.resetModules();
    deleteResource.mockClear();
    const store = await import("@/lib/connections/store");
    connectionId = store.saveConnection({
      tech: "kubernetes",
      name: "prod-cluster",
      config: { source: "path", kubeconfigPath: "~/.kube/config" },
      status: "ok",
    }).id;
    route = await import("./[id]/yaml/[kind]/[name]/route");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("deletes a namespaced resource through the driver", async () => {
    const res = await route.DELETE(
      req(`http://localhost/api/kubernetes/${connectionId}/yaml/pod/api-0?namespace=payments`),
      ctx(connectionId, "pod", "api-0"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(deleteResource).toHaveBeenCalledWith(
      connectionId,
      expect.objectContaining({ source: "path" }),
      "pod",
      "payments",
      "api-0",
    );
  });

  it("passes no namespace for cluster-scoped kinds", async () => {
    const res = await route.DELETE(
      req(`http://localhost/api/kubernetes/${connectionId}/yaml/namespace/payments`),
      ctx(connectionId, "namespace", "payments"),
    );

    expect(res.status).toBe(200);
    expect(deleteResource).toHaveBeenCalledWith(
      connectionId,
      expect.anything(),
      "namespace",
      undefined,
      "payments",
    );
  });

  it("404s on an unknown connection without touching the cluster", async () => {
    const res = await route.DELETE(
      req("http://localhost/api/kubernetes/nope/yaml/pod/api-0?namespace=default"),
      ctx("nope", "pod", "api-0"),
    );

    expect(res.status).toBe(404);
    expect(deleteResource).not.toHaveBeenCalled();
  });

  it("reports a driver failure as 502 with a formatted error", async () => {
    deleteResource.mockRejectedValueOnce(
      Object.assign(new Error(""), { code: "ECONNREFUSED" }),
    );

    const res = await route.DELETE(
      req(`http://localhost/api/kubernetes/${connectionId}/yaml/pod/api-0?namespace=default`),
      ctx(connectionId, "pod", "api-0"),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("ECONNREFUSED");
  });
});
