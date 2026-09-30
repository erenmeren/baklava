import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// proxy() is the auth + connection-access gate. The connection-access portion
// only runs for authenticated users on connection-scoped paths, so most cases
// here need a real session cookie + seeded user/connection. Every store caches
// on globalThis → reset each slot between tests.
const AUTH_CACHE = Symbol.for("baklava.authState");
const USERS_CACHE = Symbol.for("baklava.usersStore");
const SESSION_CACHE = Symbol.for("baklava.sessionStore");
const CONN_CACHE = Symbol.for("baklava.connectionStore");
const ACCESS_CACHE = Symbol.for("baklava.connectionAccess");

const SESSION_COOKIE_NAME = "baklava_session";

function resetCaches() {
  const g = globalThis as Record<symbol, unknown>;
  delete g[AUTH_CACHE];
  delete g[USERS_CACHE];
  delete g[SESSION_CACHE];
  delete g[CONN_CACHE];
  delete g[ACCESS_CACHE];
}

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-proxy-test-"));
  process.env.BAKLAVA_DATA_DIR = TMP;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
  resetCaches();
});

afterEach(() => {
  resetCaches();
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function load() {
  const users = await import("@/lib/auth/users");
  users._resetUsersCacheForTests();
  const sessions = await import("@/lib/auth/sessions");
  sessions._resetSessionCacheForTests();
  const access = await import("@/lib/connections/access");
  access._resetAccessCacheForTests();
  const session = await import("@/lib/auth/session");
  const authStore = await import("@/lib/auth/store");
  const store = await import("@/lib/connections/store");
  const proxy = await import("./proxy");
  return { users, sessions, access, session, authStore, store, proxy };
}

type Ctx = Awaited<ReturnType<typeof load>>;

async function seed() {
  const ctx = await load();
  // auth/store.ts pins DATA_DIR at module import, so across this file auth.json
  // lives in whichever TMP was first; auth stays configured. The first users
  // load therefore runs the legacy migration which fabricates an admin user
  // (and revokes prior sessions). We let it create the admin, then read it back
  // and create our member users + sessions AFTER, so the sessions survive.
  ctx.authStore.setPassword("pw"); // ensure auth configured → gate active
  ctx.users.listUsers(); // trigger lazy legacy migration (creates "admin")
  const admin =
    ctx.users.getUserByUsername("admin") ??
    ctx.users.createUser({ username: "admin", password: "pw", role: "admin" });
  const owner = ctx.users.createUser({ username: "owner", password: "pw", role: "member" });
  const stranger = ctx.users.createUser({ username: "stranger", password: "pw", role: "member" });
  const adminToken = ctx.session.createSessionToken(admin.id);
  const ownerToken = ctx.session.createSessionToken(owner.id);
  const strangerToken = ctx.session.createSessionToken(stranger.id);
  const conn = ctx.store.saveConnection({
    tech: "postgres",
    name: "owner-db",
    config: { host: "localhost" } as unknown as Record<string, unknown>,
    status: "untested",
    ownerId: owner.id,
  });
  return { ...ctx, admin, owner, stranger, adminToken, ownerToken, strangerToken, conn };
}

function req(url: string, opts?: { token?: string; method?: string }): NextRequest {
  return new NextRequest(url, {
    method: opts?.method ?? "GET",
    headers: opts?.token ? { cookie: `${SESSION_COOKIE_NAME}=${opts.token}` } : {},
  });
}

describe("connectionIdFromPath", () => {
  let connectionIdFromPath: Ctx["proxy"]["connectionIdFromPath"];
  const techIds = new Set(["postgres", "docker", "mysql", "kafka"]);

  beforeEach(async () => {
    const { proxy } = await load();
    connectionIdFromPath = proxy.connectionIdFromPath;
  });

  it("matches /api/connections/<id>", () => {
    expect(connectionIdFromPath("/api/connections/abc", techIds)).toBe("abc");
    expect(connectionIdFromPath("/api/connections/abc/access", techIds)).toBe("abc");
  });

  it("matches /api/ai/connections/<id>", () => {
    expect(connectionIdFromPath("/api/ai/connections/xyz", techIds)).toBe("xyz");
    expect(connectionIdFromPath("/api/ai/connections/xyz/chat", techIds)).toBe("xyz");
  });

  it("matches /api/<tech>/<id>/...", () => {
    expect(connectionIdFromPath("/api/postgres/c1/query", techIds)).toBe("c1");
    expect(connectionIdFromPath("/api/docker/c2", techIds)).toBe("c2");
  });

  it("matches /api/dashboard/<id>/... (non-tech connection-scoped prefix)", () => {
    expect(connectionIdFromPath("/api/dashboard/c1/health", techIds)).toBe("c1");
    expect(connectionIdFromPath("/api/dashboard/c1", techIds)).toBe("c1");
  });

  it("matches workspace pages /<tech>/<id>/...", () => {
    expect(connectionIdFromPath("/postgres/c1/tables", techIds)).toBe("c1");
    expect(connectionIdFromPath("/docker/c2", techIds)).toBe("c2");
  });

  it("returns null for non-connection paths", () => {
    expect(connectionIdFromPath("/api/auth/login", techIds)).toBeNull();
    expect(connectionIdFromPath("/api/users/x", techIds)).toBeNull();
    expect(connectionIdFromPath("/settings", techIds)).toBeNull();
    expect(connectionIdFromPath("/", techIds)).toBeNull();
    expect(connectionIdFromPath("/login", techIds)).toBeNull();
    // unknown tech segment is not a connection path
    expect(connectionIdFromPath("/api/notatech/c1/x", techIds)).toBeNull();
    expect(connectionIdFromPath("/dashboard/widgets", techIds)).toBeNull();
  });

  it("does not match the tech catalog root /api/<tech> alone", () => {
    // single-segment under /api needs the connection id segment
    expect(connectionIdFromPath("/api/postgres", techIds)).toBeNull();
  });
});

describe("proxy() connection-access gate", () => {
  it("member with no grant hitting another's connection API → 403", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/query`, { token: ctx.strangerToken, method: "POST" }),
    );
    expect(res.status).toBe(403);
  });

  it("admin → passes through (next)", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/query`, { token: ctx.adminToken, method: "POST" }),
    );
    // NextResponse.next() carries the rewrite header, not a 403.
    expect(res.status).not.toBe(403);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("member with a read grant on a GET → passes", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/tables`, { token: ctx.strangerToken }),
    );
    expect(res.status).not.toBe(403);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("owner → passes", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/query`, { token: ctx.ownerToken, method: "POST" }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("member with no grant on a workspace page → redirect to /", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/postgres/${ctx.conn.id}/tables`, { token: ctx.strangerToken }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/");
  });

  it("PATCH /api/connections/<id> with only read access → 403 (write floor)", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/connections/${ctx.conn.id}`, { token: ctx.strangerToken, method: "PATCH" }),
    );
    expect(res.status).toBe(403);
  });

  it("PATCH /api/connections/<id> with write access → passes", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "write" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/connections/${ctx.conn.id}`, { token: ctx.strangerToken, method: "PATCH" }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("GET /api/connections/<id> with read access → passes (write floor is mutation-only)", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/connections/${ctx.conn.id}`, { token: ctx.strangerToken }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("unknown connection id → passes through (route 404s normally)", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/does-not-exist/query`, { token: ctx.strangerToken }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("member with no grant hitting another's /api/dashboard/<id>/health → 403", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/dashboard/${ctx.conn.id}/health`, { token: ctx.strangerToken }),
    );
    expect(res.status).toBe(403);
  });

  it("owner hitting /api/dashboard/<id>/health → passes", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/dashboard/${ctx.conn.id}/health`, { token: ctx.ownerToken }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("non-connection API path is untouched by the gate", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(req("http://localhost/api/users", { token: ctx.strangerToken }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

// A member with `read` could previously POST/PUT/DELETE anything under a
// connection they were only meant to look at. The floor now covers every
// connection-scoped path, with a narrow allowlist for POSTs that are reads
// wearing a POST because the query travels in the body.
describe("proxy() write floor on connection-scoped paths", () => {
  it("POST /api/<tech>/<id>/... with only read access → 403", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/databases/app/query`, {
        token: ctx.strangerToken,
        method: "POST",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/<tech>/<id>/... with write access → passes", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "write" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/databases/app/query`, {
        token: ctx.strangerToken,
        method: "POST",
      }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("DELETE on a tech resource with only read access → 403", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/kubernetes/${ctx.conn.id}/yaml/pod/api-0`, {
        token: ctx.strangerToken,
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("PUT on a tech resource with only read access → 403", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/kubernetes/${ctx.conn.id}/yaml/pod/api-0`, {
        token: ctx.strangerToken,
        method: "PUT",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("owner POSTing to their own connection → passes", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/databases/app/query`, {
        token: ctx.ownerToken,
        method: "POST",
      }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("admin POSTing anywhere → passes", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/databases/app/query`, {
        token: ctx.adminToken,
        method: "POST",
      }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("GET is unaffected by the floor", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${ctx.conn.id}/databases`, {
        token: ctx.strangerToken,
      }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  const READ_SHAPED = [
    ["kafka topic search", (id: string) => `/api/kafka/${id}/topics/orders/search`],
    ["qdrant vector search", (id: string) => `/api/qdrant/${id}/collections/docs/search`],
    ["mongo distinct", (id: string) => `/api/mongo/${id}/databases/app/collections/users/distinct`],
    ["mongo explain", (id: string) => `/api/mongo/${id}/databases/app/collections/users/explain`],
    ["docker fs list", (id: string) => `/api/docker/${id}/containers/abc/fs/list`],
    ["docker fs cat", (id: string) => `/api/docker/${id}/containers/abc/fs/cat`],
  ] as const;

  for (const [label, path] of READ_SHAPED) {
    it(`${label} is a read wearing a POST → passes with read access`, async () => {
      const ctx = await seed();
      ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
      const res = ctx.proxy.proxy(
        req(`http://localhost${path(ctx.conn.id)}`, {
          token: ctx.strangerToken,
          method: "POST",
        }),
      );
      expect(res.headers.get("x-middleware-next")).toBe("1");
    });

    it(`${label} still requires a grant — no access is still 403`, async () => {
      const ctx = await seed();
      const res = ctx.proxy.proxy(
        req(`http://localhost${path(ctx.conn.id)}`, {
          token: ctx.strangerToken,
          method: "POST",
        }),
      );
      expect(res.status).toBe(403);
    });
  }

  // These read *look* like the allowlisted ones and are deliberately excluded:
  // producing a Kafka message is a write, and postgres EXPLAIN defaults to
  // ANALYZE, which runs the statement.
  const NOT_READ_SHAPED = [
    ["kafka produce", (id: string) => `/api/kafka/${id}/topics/orders/messages`],
    ["postgres explain (ANALYZE)", (id: string) => `/api/postgres/${id}/databases/app/explain`],
    ["mongo aggregate ($out can write)", (id: string) => `/api/mongo/${id}/databases/app/collections/users/aggregate`],
    ["redis command", (id: string) => `/api/redis/${id}/command`],
  ] as const;

  for (const [label, path] of NOT_READ_SHAPED) {
    it(`${label} is not allowlisted → 403 with read access`, async () => {
      const ctx = await seed();
      ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
      const res = ctx.proxy.proxy(
        req(`http://localhost${path(ctx.conn.id)}`, {
          token: ctx.strangerToken,
          method: "POST",
        }),
      );
      expect(res.status).toBe(403);
    });
  }

  // The mongo documents route dispatches on `?action=`, which the proxy *can*
  // see — so find stays a read while insert/replace/delete need write.
  it("mongo documents find → passes with read access", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(
        `http://localhost/api/mongo/${ctx.conn.id}/databases/app/collections/users/documents?action=find`,
        { token: ctx.strangerToken, method: "POST" },
      ),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("mongo documents with no action is a find → passes with read access", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(
        `http://localhost/api/mongo/${ctx.conn.id}/databases/app/collections/users/documents`,
        { token: ctx.strangerToken, method: "POST" },
      ),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  for (const action of ["insert", "replace", "delete"]) {
    it(`mongo documents ${action} → 403 with read access`, async () => {
      const ctx = await seed();
      ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
      const res = ctx.proxy.proxy(
        req(
          `http://localhost/api/mongo/${ctx.conn.id}/databases/app/collections/users/documents?action=${action}`,
          { token: ctx.strangerToken, method: "POST" },
        ),
      );
      expect(res.status).toBe(403);
    });
  }

  it("a POST to an unrelated API is untouched", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req("http://localhost/api/users", { token: ctx.strangerToken, method: "POST" }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy() percent-encoded connection ids", () => {
  // nextUrl.pathname stays encoded but Next decodes params for the handler, so
  // the gate must judge the decoded id or `%61bc` sneaks past as "unknown".
  const encode = (id: string) =>
    [...id].map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

  it("decodes the id segment", async () => {
    const { proxy } = await load();
    const techIds = new Set(["postgres"]);
    expect(proxy.connectionIdFromPath("/api/postgres/%61bc/query", techIds)).toBe("abc");
    expect(proxy.connectionIdFromPath("/postgres/%61bc", techIds)).toBe("abc");
  });

  it("no grant + fully encoded id → 403", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${encode(ctx.conn.id)}/query`, {
        token: ctx.strangerToken,
        method: "POST",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("read grant + encoded id still hits the write floor", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.conn.id, { [ctx.stranger.id]: "read" });
    const res = ctx.proxy.proxy(
      req(`http://localhost/api/postgres/${encode(ctx.conn.id)}/query`, {
        token: ctx.strangerToken,
        method: "POST",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("malformed escape in the id → 400", async () => {
    const ctx = await seed();
    const res = ctx.proxy.proxy(
      req("http://localhost/api/postgres/%E0%A4%A/query", { token: ctx.strangerToken }),
    );
    expect(res.status).toBe(400);
  });
});

describe("proxy matcher", () => {
  // Next compiles `/(…)` matchers to an anchored regex over the pathname.
  const matches = async (pathname: string) => {
    const { proxy } = await load();
    const src = proxy.config.matcher[0];
    return new RegExp(`^${src}$`).test(pathname);
  };

  it.each([
    "/api/kafka/c1/topics/foo.js",
    "/api/mysql/c1/databases/d/tables/x.css",
    "/api/s3/c1/buckets/b/objects/logo.png",
    "/kafka/c1/topics/foo.js",
    "/api/auth/security",
    "/",
  ])("runs on %s", async (p) => {
    expect(await matches(p)).toBe(true);
  });

  it.each([
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/fonts/Geist-Variable.woff2",
    "/icons/postgres.svg",
    "/favicon.ico",
    "/icon.svg",
    "/xterm.css",
    "/og-image.png",
  ])("skips static asset %s", async (p) => {
    expect(await matches(p)).toBe(false);
  });
});

describe("proxy() cross-site gate", () => {
  const make = (url: string, method: string, headers: Record<string, string>) =>
    new NextRequest(url, { method, headers: { host: "localhost:3000", ...headers } });

  afterEach(() => {
    delete process.env.BAKLAVA_ALLOWED_ORIGINS;
    delete process.env.BAKLAVA_TRUST_PROXY;
  });

  it("refuses a POST from another origin — even with the login gate off", async () => {
    const { proxy, authStore } = await load();
    authStore.setAuthEnabled(false);
    try {
      const res = proxy.proxy(
        make("http://localhost:3000/api/postgres/c1/query", "POST", { origin: "http://evil.example" }),
      );
      expect(res.status).toBe(403);
    } finally {
      authStore.setAuthEnabled(true);
    }
  });

  it("refuses a POST from a sibling port (same-site, cookies still sent)", async () => {
    const { proxy } = await load();
    const res = proxy.proxy(
      make("http://localhost:3000/api/auth/security", "POST", { origin: "http://localhost:8080" }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses an API GET labelled cross-site or same-site (EventSource-shaped actions)", async () => {
    const { proxy } = await load();
    for (const site of ["cross-site", "same-site"]) {
      const res = proxy.proxy(
        make("http://localhost:3000/api/techs/redis/uninstall", "GET", { "sec-fetch-site": site }),
      );
      expect(res.status).toBe(403);
    }
  });

  it("lets a cross-site top-level navigation to a page through", async () => {
    const { proxy } = await load();
    const res = proxy.proxy(make("http://localhost:3000/login", "GET", { "sec-fetch-site": "cross-site" }));
    expect(res.status).not.toBe(403);
  });

  it("allows same-origin requests and non-browser clients", async () => {
    const { proxy } = await load();
    expect(
      proxy.crossSiteRejection(
        make("http://localhost:3000/api/auth/login", "POST", {
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBeNull();
    expect(proxy.crossSiteRejection(make("http://localhost:3000/api/auth/login", "POST", {}))).toBeNull();
  });

  it("refuses Origin: null", async () => {
    const { proxy } = await load();
    expect(
      proxy.crossSiteRejection(make("http://localhost:3000/api/auth/login", "POST", { origin: "null" }))?.status,
    ).toBe(403);
  });

  it("honours X-Forwarded-Host only behind a trusted proxy, and BAKLAVA_ALLOWED_ORIGINS", async () => {
    const { proxy } = await load();
    const viaProxy = () =>
      make("http://localhost:3000/api/auth/login", "POST", {
        origin: "https://ops.example.com",
        "x-forwarded-host": "ops.example.com",
      });
    expect(proxy.crossSiteRejection(viaProxy())?.status).toBe(403);
    process.env.BAKLAVA_TRUST_PROXY = "1";
    expect(proxy.crossSiteRejection(viaProxy())).toBeNull();
    delete process.env.BAKLAVA_TRUST_PROXY;
    process.env.BAKLAVA_ALLOWED_ORIGINS = "https://ops.example.com";
    expect(proxy.crossSiteRejection(viaProxy())).toBeNull();
  });
});
