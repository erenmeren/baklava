import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "baklava_session";

vi.mock("@/lib/connections/docker", () => ({
  inspectContainer: vi.fn(async () => ({
    Id: "abc",
    Config: { Image: "app", Env: ["DB_PASSWORD=hunter2", "NOVALUE"] },
  })),
  containerAction: vi.fn(async () => {}),
  dockerErrorStatus: () => 502,
}));

function ctx(id: string, cid: string) {
  return { params: Promise.resolve({ id, cid }) };
}

function req(url: string, token?: string): NextRequest {
  return new NextRequest(
    new Request(url, {
      headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
    }),
  );
}

/** A container's Config.Env holds its secrets; a `read` grant sees names only. */
describe("GET /api/docker/[id]/containers/[cid] env redaction", () => {
  let dataDir: string;
  let route: typeof import("./[id]/containers/[cid]/route");
  let connId: string;
  let readerToken: string;
  let writerToken: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-docker-env-"));
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
      tech: "docker",
      name: "prod-docker",
      config: { mode: "tcp", host: "127.0.0.1", port: 2375 },
      status: "ok",
      ownerId: owner.id,
    }).id;
    access.setGrants(connId, { [reader.id]: "read", [writer.id]: "write" });
    route = await import("./[id]/containers/[cid]/route");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const url = () => `http://localhost/api/docker/${connId}/containers/abc`;

  it("redacts env values for a read-only member", async () => {
    const res = await route.GET(req(url(), readerToken), ctx(connId, "abc"));
    const body = await res.json();
    expect(body.Config.Env).toEqual(["DB_PASSWORD=<redacted>", "NOVALUE"]);
  });

  it("redacts when there is no session", async () => {
    const res = await route.GET(req(url()), ctx(connId, "abc"));
    expect((await res.json()).Config.Env[0]).toBe("DB_PASSWORD=<redacted>");
  });

  it("shows env values to a member with write", async () => {
    const res = await route.GET(req(url(), writerToken), ctx(connId, "abc"));
    expect((await res.json()).Config.Env[0]).toBe("DB_PASSWORD=hunter2");
  });
});
