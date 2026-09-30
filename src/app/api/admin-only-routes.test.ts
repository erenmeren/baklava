import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

// A signed-in *member* must not be able to reach the settings and connection
// sources that act for everyone (or as the Baklava host). The proxy only
// requires a session on these paths, so each handler has to check the role.

const MEMBER = {
  id: "m1",
  username: "member",
  role: "member" as const,
  disabled: false,
  createdAt: 0,
  updatedAt: 0,
  passwordHash: "",
  salt: "",
};

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "baklava-admin-only-"));
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
  vi.resetModules();
  vi.doMock("@/lib/auth/current-user", async () => {
    const actual = await vi.importActual<typeof import("@/lib/auth/current-user")>(
      "@/lib/auth/current-user",
    );
    return {
      ...actual,
      getCurrentUser: () => MEMBER,
      requireUser: () => MEMBER,
      requireAdmin: () => {
        throw new actual.AuthError(403, "Admin required");
      },
    };
  });
});

afterEach(() => {
  vi.doUnmock("@/lib/auth/current-user");
  vi.restoreAllMocks();
  rmSync(dataDir, { recursive: true, force: true });
});

function post(body: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/x", { method, body: JSON.stringify(body) });
}

describe("admin-only settings", () => {
  it("member cannot turn the login gate off", async () => {
    const setAuthEnabled = vi.fn();
    vi.doMock("@/lib/auth/store", () => ({ isAuthEnabled: () => true, setAuthEnabled }));
    const route = await import("./auth/security/route");
    const res = await route.POST(post({ enabled: false }));
    expect(res.status).toBe(403);
    expect(setAuthEnabled).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/auth/store");
  });

  it("member cannot flip the AI kill switch", async () => {
    const route = await import("./ai/kill-switch/route");
    const res = await route.POST(post({ on: false }));
    expect(res.status).toBe(403);
  });

  it("member cannot change the AI provider settings", async () => {
    const route = await import("./ai/settings/route");
    const res = await route.POST(post({ provider: "anthropic", apiKey: "sk-attacker" }));
    expect(res.status).toBe(403);
  });
});

describe("host-local connection sources are admin-only", () => {
  it("docker socket probe → 403 before the daemon is touched", async () => {
    const pingDocker = vi.fn();
    vi.doMock("@/lib/connections/docker", () => ({ pingDocker }));
    const route = await import("./docker/test/route");
    const res = await route.POST(post({ name: "d", config: { mode: "socket" }, save: true }));
    expect(res.status).toBe(403);
    expect(pingDocker).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/connections/docker");
  });

  it("docker tcp is still allowed for a member", async () => {
    vi.doMock("@/lib/connections/docker", () => ({ pingDocker: vi.fn(async () => ({})) }));
    const route = await import("./docker/test/route");
    const res = await route.POST(post({ config: { mode: "tcp", host: "10.0.0.5", port: 2375 } }));
    expect((await res.json()).ok).toBe(true);
    vi.doUnmock("@/lib/connections/docker");
  });

  it("kubeconfig path → 403", async () => {
    const probe = vi.fn();
    vi.doMock("@/lib/connections/kubernetes", () => ({ probe, dropKubernetesClient: vi.fn() }));
    const route = await import("./kubernetes/test/route");
    const res = await route.POST(post({ config: { source: "path", kubeconfigPath: "~/.kube/config" } }));
    expect(res.status).toBe(403);
    expect(probe).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/connections/kubernetes");
  });

  it("inline kubeconfig with an exec plugin → 403 before it can spawn", async () => {
    const probe = vi.fn();
    vi.doMock("@/lib/connections/kubernetes", () => ({ probe, dropKubernetesClient: vi.fn() }));
    const route = await import("./kubernetes/test/route");
    const yaml = [
      "users:",
      "- name: u",
      "  user:",
      "    exec: { command: /bin/sh, args: ['-c', 'id'] }",
    ].join("\n");
    const res = await route.POST(post({ config: { source: "inline", kubeconfigYaml: yaml } }));
    expect(res.status).toBe(403);
    expect(probe).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/connections/kubernetes");
  });

  it("PATCH re-pointing an owned tcp docker connection at the socket → 403", async () => {
    const store = await import("@/lib/connections/store");
    const conn = store.saveConnection({
      tech: "docker",
      name: "d",
      config: { mode: "tcp", host: "10.0.0.5", port: 2375 },
      status: "ok",
      ownerId: MEMBER.id,
    });
    const route = await import("./connections/[id]/route");
    const ctx = { params: Promise.resolve({ id: conn.id }) };
    const res = await route.PATCH(post({ config: { mode: "socket" } }, "PATCH"), ctx);
    expect(res.status).toBe(403);
    expect(store.getConnection(conn.id)?.config).toMatchObject({ mode: "tcp" });

    // Renaming doesn't touch the location, so it still works.
    const ok = await route.PATCH(post({ name: "renamed" }, "PATCH"), ctx);
    expect(ok.status).toBe(200);
  });
});
