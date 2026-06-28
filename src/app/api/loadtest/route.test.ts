import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freshRoutes(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  const [listRoute, idRoute, store] = await Promise.all([
    import("./route"),
    import("./[id]/route"),
    import("@/lib/loadtest/store"),
  ]);
  return { listRoute, idRoute, store };
}

// Stand-in users. The loadtest routes resolve the acting user via
// getCurrentUser(req); we mock that module per-test so a request can act as a
// specific user (or be unauthenticated).
const ALICE = { id: "user-alice", username: "alice", role: "member" };
const BOB = { id: "user-bob", username: "bob", role: "member" };

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

async function actAs(user: { id: string } | null) {
  const mod = await import("@/lib/auth/current-user");
  (mod.getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue(user);
}

const BODY = {
  name: "My Test",
  config: {
    target: { baseUrl: "https://api.example.com" },
    requests: [{ name: "list", method: "GET" as const, path: "/items" }],
    auth: { type: "bearer" as const, token: "secret-token" },
    profile: { type: "constant" as const, vus: 1, duration: "1s" },
  },
};

function post(body: unknown) {
  return new Request("http://localhost/api/loadtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("loadtest CRUD API", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-api-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("POST creates a test owned by the acting user; GET lists it redacted", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    await actAs(ALICE);
    const created = await listRoute.POST(post(BODY));
    expect(created.status).toBe(201);

    const listRes = await listRoute.GET(new Request("http://localhost"));
    const data = (await listRes.json()) as {
      loadtests: { name: string; config: { auth: { token: string } } }[];
    };
    expect(data.loadtests).toHaveLength(1);
    expect(data.loadtests[0].name).toBe("My Test");
    expect(data.loadtests[0].config.auth.token).not.toBe("secret-token");
  });

  it("GET list only returns the acting user's tests", async () => {
    const { listRoute, store } = await freshRoutes(dataDir);
    store.saveLoadTest(ALICE.id, BODY);
    store.saveLoadTest(BOB.id, { ...BODY, name: "Bobs Test" });

    await actAs(ALICE);
    const res = await listRoute.GET(new Request("http://localhost"));
    const data = (await res.json()) as { loadtests: { name: string }[] };
    expect(data.loadtests).toHaveLength(1);
    expect(data.loadtests[0].name).toBe("My Test");
  });

  it("POST and GET require authentication (401)", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    await actAs(null);
    expect((await listRoute.POST(post(BODY))).status).toBe(401);
    expect((await listRoute.GET(new Request("http://localhost"))).status).toBe(401);
  });

  it("POST rejects an invalid config with 400", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    await actAs(ALICE);
    const res = await listRoute.POST(
      post({ name: "x", config: { target: { baseUrl: "nope" }, requests: [], profile: {} } }),
    );
    expect(res.status).toBe(400);
  });

  it("GET [id] returns owner's redacted test; 404 when missing", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const t = store.saveLoadTest(ALICE.id, BODY);

    await actAs(ALICE);
    const ok = await idRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: t.id }),
    });
    expect(ok.status).toBe(200);
    const miss = await idRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(miss.status).toBe(404);
  });

  it("GET/PATCH/DELETE [id] 404 for a non-owner (hide existence)", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const t = store.saveLoadTest(ALICE.id, BODY);

    await actAs(BOB);
    const get = await idRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: t.id }),
    });
    expect(get.status).toBe(404);

    const patchReq = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "hacked" }),
    });
    const patch = await idRoute.PATCH(patchReq, { params: Promise.resolve({ id: t.id }) });
    expect(patch.status).toBe(404);

    const del = await idRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: t.id }),
    });
    expect(del.status).toBe(404);

    // Untouched and still Alice's.
    expect(store.getLoadTest(t.id, ALICE.id)?.name).toBe("My Test");
  });

  it("[id] handlers require authentication (401)", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const t = store.saveLoadTest(ALICE.id, BODY);
    await actAs(null);
    const get = await idRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: t.id }),
    });
    expect(get.status).toBe(401);
  });

  it("PATCH preserves the token when blank; DELETE removes the owner's test", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const t = store.saveLoadTest(ALICE.id, BODY);

    await actAs(ALICE);
    const patchReq = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Renamed",
        config: { ...BODY.config, auth: { type: "bearer", token: "" } },
      }),
    });
    const patched = await idRoute.PATCH(patchReq, { params: Promise.resolve({ id: t.id }) });
    expect(patched.status).toBe(200);
    expect(store.getLoadTest(t.id, ALICE.id)?.name).toBe("Renamed");
    expect(store.getLoadTest(t.id, ALICE.id)?.config.auth).toEqual({
      type: "bearer",
      token: "secret-token",
    });

    const del = await idRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: t.id }),
    });
    expect(del.status).toBe(200);
    expect(store.getLoadTest(t.id, ALICE.id)).toBeUndefined();
  });
});
