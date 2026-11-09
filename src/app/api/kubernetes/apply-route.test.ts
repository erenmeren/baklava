import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const applyManifests = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => []);
vi.mock("@/lib/connections/kubernetes/apply", () => ({
  applyManifests: (...a: unknown[]) => applyManifests(...a),
}));

const CM = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n";
const SESSION_COOKIE_NAME = "baklava_session";

function resetCaches() {
  const g = globalThis as Record<symbol, unknown>;
  for (const k of ["authState", "usersStore", "sessionStore", "connectionStore", "connectionAccess"]) {
    delete g[Symbol.for(`baklava.${k}`)];
  }
}

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "baklava-k8s-apply-"));
  process.env.BAKLAVA_DATA_DIR = dataDir;
  resetCaches();
  vi.resetModules();
  applyManifests.mockClear();
});
afterEach(() => {
  resetCaches();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("POST /api/kubernetes/[id]/apply", () => {
  async function setup() {
    const store = await import("@/lib/connections/store");
    const id = store.saveConnection({
      tech: "kubernetes",
      name: "c",
      config: { source: "inline", kubeconfigYaml: "x" },
      status: "ok",
    }).id;
    const route = await import("./[id]/apply/route");
    const call = (body: unknown, cid = id) =>
      route.POST(
        new NextRequest(
          new Request("http://localhost", {
            method: "POST",
            body: typeof body === "string" ? body : JSON.stringify(body),
          }),
        ),
        { params: Promise.resolve({ id: cid }) },
      );
    return { id, call };
  }

  it("passes dryRun, force and the namespace through to the driver", async () => {
    const { id, call } = await setup();
    applyManifests.mockResolvedValueOnce([{ kind: "ConfigMap", name: "x", action: "created" }]);
    const res = await call({ yaml: CM, namespace: "demo", dryRun: true });
    expect(res.status).toBe(200);
    expect(applyManifests).toHaveBeenCalledWith(id, expect.anything(), CM, {
      namespace: "demo",
      dryRun: true,
      force: false,
    });
    const body = (await res.json()) as { dryRun: boolean; results: unknown[] };
    expect(body).toEqual({ dryRun: true, results: [{ kind: "ConfigMap", name: "x", action: "created" }] });
  });

  it("treats the all-namespaces marker as no default namespace", async () => {
    const { call } = await setup();
    await call({ yaml: CM, namespace: "*", dryRun: false, force: true });
    expect(applyManifests.mock.calls[0][3]).toEqual({ namespace: undefined, dryRun: false, force: true });
  });

  it("rejects bad bodies with 400 before reaching the cluster", async () => {
    const { call } = await setup();
    for (const body of ["not json", { dryRun: true }, { yaml: CM }, { yaml: CM, dryRun: "yes" }, { yaml: CM, dryRun: true, force: 1 }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(applyManifests).not.toHaveBeenCalled();
  });

  it("rejects oversize YAML with 413", async () => {
    const { call } = await setup();
    const res = await call({ yaml: `# ${"x".repeat(600 * 1024)}\n${CM}`, dryRun: true });
    expect(res.status).toBe(413);
    expect(applyManifests).not.toHaveBeenCalled();
  });

  it("maps a ManifestError to 400 and other failures to 502", async () => {
    const { call } = await setup();
    const { ManifestError } = await import("@/lib/kubernetes/manifests");
    applyManifests.mockRejectedValueOnce(new ManifestError("document 1: missing kind"));
    const bad = await call({ yaml: CM, dryRun: true });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("missing kind");
    applyManifests.mockRejectedValueOnce(Object.assign(new Error(""), { code: "ECONNREFUSED" }));
    expect((await call({ yaml: CM, dryRun: true })).status).toBe(502);
  });

  it("404s on an unknown connection", async () => {
    const { call } = await setup();
    expect((await call({ yaml: CM, dryRun: true }, "nope")).status).toBe(404);
  });
});

describe("proxy gate on /api/kubernetes/<id>/apply", () => {
  async function seed(config: Record<string, unknown>) {
    const users = await import("@/lib/auth/users");
    users._resetUsersCacheForTests();
    const sessions = await import("@/lib/auth/sessions");
    sessions._resetSessionCacheForTests();
    const access = await import("@/lib/connections/access");
    access._resetAccessCacheForTests();
    const session = await import("@/lib/auth/session");
    const authStore = await import("@/lib/auth/store");
    const store = await import("@/lib/connections/store");
    const { proxy } = await import("@/proxy");
    authStore.setPassword("pw");
    users.listUsers();
    const admin =
      users.getUserByUsername("admin") ??
      users.createUser({ username: "admin", password: "pw", role: "admin" });
    const owner = users.createUser({ username: "owner", password: "pw", role: "member" });
    const reader = users.createUser({ username: "reader", password: "pw", role: "member" });
    const conn = store.saveConnection({ tech: "kubernetes", name: "k", config, status: "ok", ownerId: owner.id });
    access.setGrants(conn.id, { [reader.id]: "read" });
    const post = (userId: string, dryRun = true) =>
      proxy(
        new NextRequest(`http://localhost/api/kubernetes/${conn.id}/apply`, {
          method: "POST",
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${session.createSessionToken(userId)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ yaml: CM, dryRun }),
        }),
      );
    return { admin, owner, reader, post };
  }
  const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

  it("a read grantee gets 403, even for a dry run", async () => {
    const { reader, post } = await seed({ source: "inline", kubeconfigYaml: "apiVersion: v1\n" });
    expect((await post(reader.id, true)).status).toBe(403);
    expect((await post(reader.id, false)).status).toBe(403);
  });

  it("the owner of an inline-kubeconfig connection passes", async () => {
    const { owner, post } = await seed({ source: "inline", kubeconfigYaml: "apiVersion: v1\n" });
    expect(passed(await post(owner.id))).toBe(true);
  });

  it("a host-local (kubeconfig path) connection: member owner 403, admin passes", async () => {
    const { owner, admin, post } = await seed({ source: "path", kubeconfigPath: "~/.kube/config" });
    expect((await post(owner.id)).status).toBe(403);
    expect(passed(await post(admin.id))).toBe(true);
  });
});
