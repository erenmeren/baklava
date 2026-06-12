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

const BODY = {
  name: "My Test",
  config: {
    target: { baseUrl: "https://api.example.com" },
    requests: [{ name: "list", path: "/items" }],
    auth: { type: "bearer", token: "secret-token" },
    profile: { type: "constant", vus: 1, duration: "1s" },
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
  });

  it("POST creates a test and GET lists it with secrets redacted", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    const created = await listRoute.POST(post(BODY));
    expect(created.status).toBe(201);

    const listRes = await listRoute.GET();
    const data = (await listRes.json()) as { loadtests: { name: string; config: { auth: { token: string } } }[] };
    expect(data.loadtests).toHaveLength(1);
    expect(data.loadtests[0].name).toBe("My Test");
    expect(data.loadtests[0].config.auth.token).not.toBe("secret-token");
  });

  it("POST rejects an invalid config with 400", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    const res = await listRoute.POST(post({ name: "x", config: { target: { baseUrl: "nope" }, requests: [], profile: {} } }));
    expect(res.status).toBe(400);
  });

  it("GET [id] returns redacted test; 404 when missing", async () => {
    const { listRoute, idRoute, store } = await freshRoutes(dataDir);
    await listRoute.POST(post(BODY));
    const id = store.listLoadTests()[0].id;

    const ok = await idRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
    expect(ok.status).toBe(200);
    const miss = await idRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: "nope" }) });
    expect(miss.status).toBe(404);
  });

  it("PATCH preserves the token when blank; DELETE removes the test", async () => {
    const { listRoute, idRoute, store } = await freshRoutes(dataDir);
    await listRoute.POST(post(BODY));
    const id = store.listLoadTests()[0].id;

    const patchReq = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed", config: { ...BODY.config, auth: { type: "bearer", token: "" } } }),
    });
    const patched = await idRoute.PATCH(patchReq, { params: Promise.resolve({ id }) });
    expect(patched.status).toBe(200);
    expect(store.getLoadTest(id)?.name).toBe("Renamed");
    expect(store.getLoadTest(id)?.config.auth).toEqual({ type: "bearer", token: "secret-token" });

    const del = await idRoute.DELETE(new Request("http://localhost"), { params: Promise.resolve({ id }) });
    expect(del.status).toBe(200);
    expect(store.getLoadTest(id)).toBeUndefined();
  });
});
