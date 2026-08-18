import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "baklava_session";

const readResourceYaml = vi.fn(async () => "kind: Secret\n");
vi.mock("@/lib/connections/kubernetes", () => ({
  readResourceYaml: (...a: unknown[]) => readResourceYaml(...(a as [])),
  replaceResourceYaml: vi.fn(async () => {}),
  deleteResource: vi.fn(async () => {}),
}));

function ctx(id: string, kind: string, name: string) {
  return { params: Promise.resolve({ id, kind, name }) };
}

function req(url: string, token?: string): NextRequest {
  return new NextRequest(
    new Request(url, {
      headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
    }),
  );
}

/** The opts argument readResourceYaml was called with. */
function lastOpts(): { redactSecretValues?: boolean } {
  const call = readResourceYaml.mock.calls.at(-1) as unknown[];
  return (call?.[5] ?? {}) as { redactSecretValues?: boolean };
}

/**
 * A Secret's manifest carries its values. The AI gate already treats them as
 * privileged (policy.allowK8sSecretValues, default off); the HTTP path must
 * not be the way around that. A `read` grant means read the *shape* of a
 * Secret — the values need write.
 */
describe("GET /api/kubernetes/[id]/yaml/[kind]/[name] secret redaction", () => {
  let dataDir: string;
  let route: typeof import("./[id]/yaml/[kind]/[name]/route");
  let connId: string;
  let ownerToken: string;
  let readerToken: string;
  let writerToken: string;
  let adminToken: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-k8s-secret-"));
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
    readResourceYaml.mockClear();

    const [store, users, session, access] = await Promise.all([
      import("@/lib/connections/store"),
      import("@/lib/auth/users"),
      import("@/lib/auth/session"),
      import("@/lib/connections/access"),
    ]);
    const owner = users.createUser({ username: "owner", password: "pw", role: "member" });
    const reader = users.createUser({ username: "reader", password: "pw", role: "member" });
    const writer = users.createUser({ username: "writer", password: "pw", role: "member" });
    const admin = users.createUser({ username: "admin", password: "pw", role: "admin" });
    ownerToken = session.createSessionToken(owner.id);
    readerToken = session.createSessionToken(reader.id);
    writerToken = session.createSessionToken(writer.id);
    adminToken = session.createSessionToken(admin.id);
    connId = store.saveConnection({
      tech: "kubernetes",
      name: "prod-cluster",
      config: { source: "path" },
      status: "ok",
      ownerId: owner.id,
    }).id;
    access.setGrants(connId, { [reader.id]: "read", [writer.id]: "write" });
    route = await import("./[id]/yaml/[kind]/[name]/route");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const url = (kind: string, name: string) =>
    `http://localhost/api/kubernetes/${connId}/yaml/${kind}/${name}?namespace=payments`;

  it("redacts a Secret for a read-only member", async () => {
    await route.GET(req(url("secret", "db"), readerToken), ctx(connId, "secret", "db"));
    expect(lastOpts().redactSecretValues).toBe(true);
  });

  it("shows the values to a member with write", async () => {
    await route.GET(req(url("secret", "db"), writerToken), ctx(connId, "secret", "db"));
    expect(lastOpts().redactSecretValues).toBe(false);
  });

  it("shows the values to the connection's owner", async () => {
    await route.GET(req(url("secret", "db"), ownerToken), ctx(connId, "secret", "db"));
    expect(lastOpts().redactSecretValues).toBe(false);
  });

  it("shows the values to an admin", async () => {
    await route.GET(req(url("secret", "db"), adminToken), ctx(connId, "secret", "db"));
    expect(lastOpts().redactSecretValues).toBe(false);
  });

  it("redacts when the request carries no session at all", async () => {
    await route.GET(req(url("secret", "db")), ctx(connId, "secret", "db"));
    expect(lastOpts().redactSecretValues).toBe(true);
  });

  it("leaves non-secret kinds alone for a read-only member", async () => {
    await route.GET(req(url("pod", "api-0"), readerToken), ctx(connId, "pod", "api-0"));
    expect(lastOpts().redactSecretValues).toBe(false);
  });
});
