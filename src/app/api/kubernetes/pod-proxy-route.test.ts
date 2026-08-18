import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "baklava_session";

const proxyPodHttp = vi.fn(async () => ({ status: 200, body: "hello", truncated: false }));
vi.mock("@/lib/connections/kubernetes", () => ({
  proxyPodHttp: (...a: unknown[]) => proxyPodHttp(...(a as [])),
}));

const ctx = (id: string) => ({ params: Promise.resolve({ id, ns: "demo", name: "api-0" }) });

function req(id: string, qs: string, token?: string): NextRequest {
  return new NextRequest(
    new Request(`http://localhost/api/kubernetes/${id}/proxy/demo/api-0${qs}`, {
      headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
    }),
  );
}

describe("GET /api/kubernetes/[id]/proxy/[ns]/[name]", () => {
  let dataDir: string;
  let route: typeof import("./[id]/proxy/[ns]/[name]/route");
  let connId: string;
  let readerToken: string;
  let writerToken: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-k8s-proxy-"));
    process.env.BAKLAVA_DATA_DIR = dataDir;
    for (const name of [
      "baklava.usersStore",
      "baklava.sessionStore",
      "baklava.authState",
      "baklava.connectionStore",
      "baklava.connectionAccess",
    ]) {
      delete (globalThis as Record<symbol, unknown>)[Symbol.for(name)];
    }
    vi.resetModules();
    proxyPodHttp.mockClear();

    const [store, users, session, access] = await Promise.all([
      import("@/lib/connections/store"),
      import("@/lib/auth/users"),
      import("@/lib/auth/session"),
      import("@/lib/connections/access"),
    ]);
    const owner = users.createUser({ username: "owner", password: "pw", role: "member" });
    const reader = users.createUser({ username: "reader", password: "pw", role: "member" });
    const writer = users.createUser({ username: "writer", password: "pw", role: "member" });
    readerToken = session.createSessionToken(reader.id);
    writerToken = session.createSessionToken(writer.id);
    connId = store.saveConnection({
      tech: "kubernetes",
      name: "prod",
      config: { source: "path" },
      status: "ok",
      ownerId: owner.id,
    }).id;
    access.setGrants(connId, { [reader.id]: "read", [writer.id]: "write" });
    route = await import("./[id]/proxy/[ns]/[name]/route");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("proxies for a member with write", async () => {
    const res = await route.GET(req(connId, "?port=80&path=/healthz", writerToken), ctx(connId));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 200, body: "hello", truncated: false });
    expect(proxyPodHttp).toHaveBeenCalledWith(
      connId,
      expect.anything(),
      "demo",
      "api-0",
      "80",
      "/healthz",
    );
  });

  it("refuses a read-only member — pods/proxy is not a read", async () => {
    const res = await route.GET(req(connId, "?port=80", readerToken), ctx(connId));
    expect(res.status).toBe(403);
    expect(proxyPodHttp).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request", async () => {
    const res = await route.GET(req(connId, "?port=80"), ctx(connId));
    expect(res.status).toBe(403);
    expect(proxyPodHttp).not.toHaveBeenCalled();
  });

  it("defaults the path to root", async () => {
    await route.GET(req(connId, "?port=80", writerToken), ctx(connId));
    expect(proxyPodHttp).toHaveBeenCalledWith(
      connId,
      expect.anything(),
      "demo",
      "api-0",
      "80",
      "/",
    );
  });

  it("reports a rejected port as 400, not 502", async () => {
    proxyPodHttp.mockRejectedValueOnce(new Error("Invalid port: 70000"));
    const res = await route.GET(req(connId, "?port=70000", writerToken), ctx(connId));
    expect(res.status).toBe(400);
  });

  it("reports a cluster failure as 502", async () => {
    proxyPodHttp.mockRejectedValueOnce(
      Object.assign(new Error(""), { code: "ECONNREFUSED" }),
    );
    const res = await route.GET(req(connId, "?port=80", writerToken), ctx(connId));
    expect(res.status).toBe(502);
  });

  it("404s on an unknown connection", async () => {
    const res = await route.GET(req("nope", "?port=80", writerToken), ctx("nope"));
    expect(res.status).toBe(404);
  });
});
