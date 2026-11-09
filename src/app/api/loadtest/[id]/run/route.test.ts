import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/loadtest/run-controller", () => ({ executeRun: vi.fn() }));

const MEMBER = { id: "user-m", username: "m", role: "member" };
const ADMIN = { id: "user-a", username: "a", role: "admin" };

const CONFIG = {
  target: { baseUrl: "http://localhost:2375" },
  requests: [{ name: "r", method: "POST" as const, path: "/containers/create" }],
  auth: { type: "none" as const },
  profile: { type: "constant" as const, vus: 1, duration: "1s" },
};

async function runAs(user: typeof MEMBER) {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  const cu = await import("@/lib/auth/current-user");
  (cu.getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue(user);
  const ctrl = await import("@/lib/loadtest/run-controller");
  const executeRun = ctrl.executeRun as unknown as ReturnType<typeof vi.fn>;
  executeRun.mockResolvedValue({ id: "r1", status: "error" });
  const store = await import("@/lib/loadtest/store");
  const test = store.saveLoadTest(user.id, { name: "t", config: CONFIG });
  const route = await import("./route");
  const res = await route.POST(new Request("http://localhost", { method: "POST" }), {
    params: Promise.resolve({ id: test.id }),
  });
  await res.text(); // drain the SSE stream so executeRun has been called
  return executeRun.mock.calls[0][2] as { allowInternalTargets?: boolean };
}

describe("POST /api/loadtest/[id]/run — internal targets", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-run-route-"));
    process.env.BAKLAVA_DATA_DIR = dataDir;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("a member may not target loopback / private hosts", async () => {
    expect((await runAs(MEMBER)).allowInternalTargets).toBe(false);
  });

  it("an admin keeps the local-service path", async () => {
    expect((await runAs(ADMIN)).allowInternalTargets).toBe(true);
  });
});
