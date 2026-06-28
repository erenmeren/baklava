import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SESSION_COOKIE_NAME = "baklava_session";

async function freshRoutes(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  // The auth gate must be ON so getCurrentUser resolves real users (not the
  // synthetic local admin). createUser enables it implicitly.
  for (const name of [
    "baklava.aiConversations",
    "baklava.usersStore",
    "baklava.sessionStore",
    "baklava.authState",
    "baklava.connectionStore",
    "baklava.connectionAccess",
  ]) {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for(name)];
  }
  vi.resetModules();
  const [listRoute, idRoute, users, session] = await Promise.all([
    import("./route"),
    import("./[id]/route"),
    import("@/lib/auth/users"),
    import("@/lib/auth/session"),
  ]);
  const a = users.createUser({ username: "alice", password: "pw", role: "member" });
  const b = users.createUser({ username: "bob", password: "pw", role: "member" });
  const admin = users.createUser({ username: "admin", password: "pw", role: "admin" });
  return {
    listRoute,
    idRoute,
    tokenA: session.createSessionToken(a.id),
    tokenB: session.createSessionToken(b.id),
    tokenAdmin: session.createSessionToken(admin.id),
  };
}

function req(token?: string, opts: { method?: string; body?: string } = {}): Request {
  return new Request("http://localhost", {
    method: opts.method,
    body: opts.body,
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
  });
}

async function createConv(listRoute: { POST: (r: Request) => Promise<Response> }, token: string, title: string) {
  const res = await listRoute.POST(req(token, { method: "POST", body: JSON.stringify({ title }) }));
  const body = await res.json();
  return body.conversation as { id: string; userId: string; title: string };
}

describe("AI conversations RBAC", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-conv-route-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("401s when unauthenticated", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    expect((await listRoute.GET(req())).status).toBe(401);
    expect((await listRoute.POST(req(undefined, { method: "POST", body: "{}" }))).status).toBe(401);
  });

  it("stamps the creator as owner and scopes the list", async () => {
    const { listRoute, tokenA, tokenB } = await freshRoutes(dataDir);
    const conv = await createConv(listRoute, tokenA, "A's chat");
    expect(conv.userId).toBeTruthy();

    const listA = await (await listRoute.GET(req(tokenA))).json();
    expect(listA.conversations.map((c: { id: string }) => c.id)).toContain(conv.id);

    // B sees an empty list — A's conversation is invisible.
    const listB = await (await listRoute.GET(req(tokenB))).json();
    expect(listB.conversations).toEqual([]);
  });

  it("GET/PUT/DELETE 404 for a non-owner (no existence oracle)", async () => {
    const { listRoute, idRoute, tokenA, tokenB } = await freshRoutes(dataDir);
    const conv = await createConv(listRoute, tokenA, "secret");
    const params = { params: Promise.resolve({ id: conv.id }) };

    // B is blocked on every verb.
    expect((await idRoute.GET(req(tokenB), params)).status).toBe(404);
    expect(
      (await idRoute.PUT(req(tokenB, { method: "PUT", body: JSON.stringify({ title: "hacked" }) }), params)).status,
    ).toBe(404);
    expect((await idRoute.DELETE(req(tokenB, { method: "DELETE" }), params)).status).toBe(404);

    // A still owns it untouched.
    const getA = await idRoute.GET(req(tokenA), params);
    expect(getA.status).toBe(200);
    expect((await getA.json()).conversation.title).toBe("secret");
  });

  it("admins cannot browse another user's conversations", async () => {
    const { listRoute, idRoute, tokenA, tokenAdmin } = await freshRoutes(dataDir);
    const conv = await createConv(listRoute, tokenA, "A only");
    const params = { params: Promise.resolve({ id: conv.id }) };

    const listAdmin = await (await listRoute.GET(req(tokenAdmin))).json();
    expect(listAdmin.conversations).toEqual([]);
    expect((await idRoute.GET(req(tokenAdmin), params)).status).toBe(404);
  });

  it("owner can update and delete", async () => {
    const { listRoute, idRoute, tokenA } = await freshRoutes(dataDir);
    const conv = await createConv(listRoute, tokenA, "orig");
    const params = { params: Promise.resolve({ id: conv.id }) };

    const put = await idRoute.PUT(
      req(tokenA, { method: "PUT", body: JSON.stringify({ title: "renamed" }) }),
      params,
    );
    expect(put.status).toBe(200);
    expect((await put.json()).conversation.title).toBe("renamed");

    const del = await idRoute.DELETE(req(tokenA, { method: "DELETE" }), params);
    expect(del.status).toBe(200);
    expect((await del.json()).ok).toBe(true);
    expect((await idRoute.GET(req(tokenA), params)).status).toBe(404);
  });
});
