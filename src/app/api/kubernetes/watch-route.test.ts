import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "baklava_session";

const watchResource = vi.fn(
  async (
    _id: string,
    _cfg: unknown,
    _resource: string,
    _ns: string,
    sink: { reset: (p: unknown) => void; upsert: (r: unknown) => void; remove: (k: string) => void },
  ) => {
    sink.reset({ rows: [{ name: "a", namespace: "demo" }], truncated: false, remaining: null, keep: [], newestFirst: false });
    sink.upsert({ name: "b", namespace: "demo" });
    sink.remove("demo/a");
  },
);
vi.mock("@/lib/connections/kubernetes/watch", () => ({
  WATCH_SPECS: { pods: {}, configmaps: {} },
  watchResource: (...a: unknown[]) => watchResource(...(a as Parameters<typeof watchResource>)),
}));

const ctx = (id: string, resource = "pods") => ({ params: Promise.resolve({ id, resource }) });

function req(id: string, resource: string, qs: string, token?: string): NextRequest {
  return new NextRequest(
    new Request(`http://localhost/api/kubernetes/${id}/watch/${resource}${qs}`, {
      headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
    }),
  );
}

describe("GET /api/kubernetes/[id]/watch/[resource]", () => {
  let dataDir: string;
  let route: typeof import("./[id]/watch/[resource]/route");
  let connId: string;
  let readerToken: string;
  let strangerToken: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-k8s-watch-"));
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
    watchResource.mockClear();

    const [store, users, session, access] = await Promise.all([
      import("@/lib/connections/store"),
      import("@/lib/auth/users"),
      import("@/lib/auth/session"),
      import("@/lib/connections/access"),
    ]);
    const owner = users.createUser({ username: "owner", password: "pw", role: "member" });
    const reader = users.createUser({ username: "reader", password: "pw", role: "member" });
    const stranger = users.createUser({ username: "stranger", password: "pw", role: "member" });
    readerToken = session.createSessionToken(reader.id);
    strangerToken = session.createSessionToken(stranger.id);
    connId = store.saveConnection({
      tech: "kubernetes",
      name: "prod",
      config: { source: "inline", kubeconfigYaml: "apiVersion: v1\nkind: Config\n", namespace: "demo" },
      status: "ok",
      ownerId: owner.id,
    }).id;
    access.setGrants(connId, { [reader.id]: "read" });
    route = await import("./[id]/watch/[resource]/route");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("refuses a member with no grant — and never opens a watch", async () => {
    const res = await route.GET(req(connId, "pods", "", strangerToken), ctx(connId));
    expect(res.status).toBe(404);
    expect(watchResource).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request", async () => {
    const res = await route.GET(req(connId, "pods", ""), ctx(connId));
    expect(res.status).toBe(404);
    expect(watchResource).not.toHaveBeenCalled();
  });

  it("streams reset / upsert / delete to a read grant", async () => {
    const res = await route.GET(req(connId, "pods", "?ns=kube-system", readerToken), ctx(connId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const body = await res.text();
    expect(body).toContain('event: reset\ndata: {"rows":[{"name":"a","namespace":"demo"}]');
    expect(body).toContain('event: upsert\ndata: {"name":"b","namespace":"demo"}');
    expect(body).toContain('event: delete\ndata: {"key":"demo/a"}');
    expect(watchResource.mock.calls[0][2]).toBe("pods");
    expect(watchResource.mock.calls[0][3]).toBe("kube-system");
  });

  it("falls back to the connection's namespace without ?ns=", async () => {
    await (await route.GET(req(connId, "pods", "", readerToken), ctx(connId))).text();
    expect(watchResource.mock.calls[0][3]).toBe("demo");
  });

  it("reports a failed watch as an error event", async () => {
    watchResource.mockRejectedValueOnce(new Error("forbidden: pods is forbidden"));
    const res = await route.GET(req(connId, "pods", "", readerToken), ctx(connId));
    expect(await res.text()).toContain('event: error\ndata: {"message":"forbidden: pods is forbidden"}');
  });

  it("404s on a resource outside the catalogue", async () => {
    const res = await route.GET(req(connId, "toString", "", readerToken), ctx(connId, "toString"));
    expect(res.status).toBe(404);
    expect(watchResource).not.toHaveBeenCalled();
  });

  it("404s on an unknown connection", async () => {
    const res = await route.GET(req("nope", "pods", "", readerToken), ctx("nope"));
    expect(res.status).toBe(404);
  });
});
