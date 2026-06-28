import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

async function freshRoutes(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  for (const name of [
    "baklava.connectionStore",
    "baklava.usersStore",
    "baklava.sessionStore",
    "baklava.authState",
    "baklava.connectionAccess",
  ]) {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for(name)];
  }
  vi.resetModules();
  const [listRoute, idRoute, store, users, session] = await Promise.all([
    import("./route"),
    import("./[id]/route"),
    import("@/lib/connections/store"),
    import("@/lib/auth/users"),
    import("@/lib/auth/session"),
  ]);
  // The list route now requires an authenticated user; seed an admin (who sees
  // every connection) and hand back a ready-to-use session cookie token.
  const admin = users.createUser({ username: "admin", password: "pw", role: "admin" });
  const adminToken = session.createSessionToken(admin.id);
  return { listRoute, idRoute, store, users, session, adminToken };
}

const SESSION_COOKIE_NAME = "baklava_session";
function withCookie(url: string, token: string): NextRequest {
  return new NextRequest(url, { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } });
}

describe("GET /api/connections", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-api-list-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns 401 when unauthenticated", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    const res = await listRoute.GET(new NextRequest("http://localhost/api/connections"));
    expect(res.status).toBe(401);
  });

  it("returns the public view of every connection (no plaintext passwords)", async () => {
    const { listRoute, store, adminToken } = await freshRoutes(dataDir);
    store.saveConnection({
      tech: "postgres",
      name: "PG",
      config: {
        host: "localhost",
        port: 5432,
        database: "x",
        user: "u",
        password: "secret-pg",
        ssl: false,
      },
      status: "ok",
    });
    store.saveConnection({
      tech: "sqlserver",
      name: "S",
      config: {
        host: "localhost",
        port: 1433,
        database: "master",
        user: "sa",
        password: "secret-ms",
        encrypt: false,
        trustServerCertificate: true,
      },
      status: "ok",
    });

    const res = await listRoute.GET(
      withCookie("http://localhost/api/connections", adminToken),
    );
    const body = await res.json();
    expect(body.connections).toHaveLength(2);
    const pg = body.connections.find((c: { tech: string }) => c.tech === "postgres");
    const ms = body.connections.find((c: { tech: string }) => c.tech === "sqlserver");
    expect(pg.config.password).not.toBe("secret-pg");
    expect(pg.config.password).toMatch(/^•+$/);
    expect(ms.config.password).not.toBe("secret-ms");
    expect(ms.config.password).toMatch(/^•+$/);
  });

  it("filters by ?tech=... when provided", async () => {
    const { listRoute, store, adminToken } = await freshRoutes(dataDir);
    store.saveConnection({
      tech: "postgres",
      name: "p",
      config: { host: "x", port: 5432, database: "d", user: "u", password: "p", ssl: false },
      status: "ok",
    });
    store.saveConnection({
      tech: "kafka",
      name: "k",
      config: { clientId: "baklava", brokers: ["x:9092"], ssl: false },
      status: "ok",
    });
    const res = await listRoute.GET(
      withCookie("http://localhost/api/connections?tech=postgres", adminToken),
    );
    const body = await res.json();
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0].tech).toBe("postgres");
  });
});

describe("GET/PATCH/DELETE /api/connections/[id]", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-api-id-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("GET returns 404 for unknown id", async () => {
    const { idRoute } = await freshRoutes(dataDir);
    const res = await idRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it("GET returns the redacted public view", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const saved = store.saveConnection({
      tech: "postgres",
      name: "x",
      config: {
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "leaky",
        ssl: false,
      },
      status: "ok",
    });
    const res = await idRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: saved.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(saved.id);
    expect(body.config.password).not.toBe("leaky");
  });

  it("PATCH rejects malformed JSON with 400", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const saved = store.saveConnection({
      tech: "postgres",
      name: "x",
      config: {
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        ssl: false,
      },
      status: "ok",
    });
    const res = await idRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: "{not json",
      }),
      { params: Promise.resolve({ id: saved.id }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/i);
  });

  it("PATCH rejects empty patch (nothing to update)", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const saved = store.saveConnection({
      tech: "postgres",
      name: "x",
      config: {
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        ssl: false,
      },
      status: "ok",
    });
    const res = await idRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: saved.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("PATCH renames + flips status to untested + redacts response password", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const saved = store.saveConnection({
      tech: "postgres",
      name: "old",
      config: {
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        ssl: false,
      },
      status: "ok",
    });
    const res = await idRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "new" }),
      }),
      { params: Promise.resolve({ id: saved.id }) },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.name).toBe("new");
    expect(body.status).toBe("untested");
    expect(body.config.password).not.toBe("p");
  });

  it("PATCH with blank password preserves the existing one (E2E for the edit-mode UX)", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const saved = store.saveConnection({
      tech: "postgres",
      name: "x",
      config: {
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "original",
        ssl: false,
      },
      status: "ok",
    });
    await idRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          config: {
            host: "h",
            port: 5432,
            database: "d",
            user: "u",
            password: "",
            ssl: false,
          },
        }),
      }),
      { params: Promise.resolve({ id: saved.id }) },
    );
    // Read it back from the store (not the API which would have redacted).
    const after = store.getConnection(saved.id);
    expect((after?.config as { password: string }).password).toBe("original");
  });

  it("DELETE removes the connection and returns ok", async () => {
    const { idRoute, store } = await freshRoutes(dataDir);
    const saved = store.saveConnection({
      tech: "postgres",
      name: "x",
      config: {
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "p",
        ssl: false,
      },
      status: "ok",
    });
    const res = await idRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: saved.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(store.getConnection(saved.id)).toBeUndefined();
  });

  it("DELETE returns 404 for unknown id", async () => {
    const { idRoute } = await freshRoutes(dataDir);
    const res = await idRoute.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });
});
