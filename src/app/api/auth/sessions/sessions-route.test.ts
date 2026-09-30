import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { _resetSessionCacheForTests } from "@/lib/auth/sessions";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-sr-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_INITIAL_PASSWORD = "x";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.authState")];
  _resetSessionCacheForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
});

function reqWithCookie(url: string, token: string, method = "GET") {
  return new Request(url, { method, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

describe("sessions API", () => {
  it("lists sessions and marks the current one", async () => {
    const { GET } = await import("./route");
    const mine = createSessionToken("u", "device-A");
    createSessionToken("u", "device-B");
    const res = await GET(reqWithCookie("http://x/api/auth/sessions", mine) as never);
    const body = (await res.json()) as { sessions: Array<{ userAgent: string; current: boolean }> };
    expect(body.sessions.length).toBe(2);
    const current = body.sessions.filter((s) => s.current);
    expect(current).toHaveLength(1);
    expect(current[0].userAgent).toBe("device-A");
  });

  it("revoke-others keeps only the caller's session", async () => {
    const { POST } = await import("./revoke-others/route");
    const mine = createSessionToken("u", "keep");
    createSessionToken("u", "drop-1");
    createSessionToken("u", "drop-2");
    const res = await POST(reqWithCookie("http://x/api/auth/sessions/revoke-others", mine, "POST") as never);
    expect(res.status).toBe(200);
    const { GET } = await import("./route");
    const list = await GET(reqWithCookie("http://x/api/auth/sessions", mine) as never);
    const body = (await list.json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(1);
  });

  it("DELETE revokes a specific session", async () => {
    const { DELETE } = await import("./[id]/route");
    const { GET } = await import("./route");
    const mine = createSessionToken("u", "keep");
    // grab the other session's id from the list
    const listed = await (await GET(reqWithCookie("http://x/api/auth/sessions", mine) as never)).json() as { sessions: Array<{ id: string; current: boolean }> };
    createSessionToken("u", "victim");
    const all = await (await GET(reqWithCookie("http://x/api/auth/sessions", mine) as never)).json() as { sessions: Array<{ id: string; current: boolean }> };
    const victim = all.sessions.find((s) => !s.current)!;
    const res = await DELETE(reqWithCookie(`http://x/api/auth/sessions/${victim.id}`, mine, "DELETE") as never, { params: Promise.resolve({ id: victim.id }) });
    expect(res.status).toBe(200);
    const after = await (await GET(reqWithCookie("http://x/api/auth/sessions", mine) as never)).json() as { sessions: unknown[] };
    expect(after.sessions).toHaveLength(1);
    void listed;
  });

  it("lists only the caller's own sessions", async () => {
    const { GET } = await import("./route");
    const mine = createSessionToken("u", "mine");
    createSessionToken("admin", "admin-laptop");
    const body = (await (await GET(reqWithCookie("http://x/api/auth/sessions", mine) as never)).json()) as {
      sessions: Array<{ userAgent: string }>;
    };
    expect(body.sessions.map((s) => s.userAgent)).toEqual(["mine"]);
  });

  it("DELETE on another user's session → 404, and it survives", async () => {
    const { DELETE } = await import("./[id]/route");
    const { getSession } = await import("@/lib/auth/sessions");
    const { sessionIdFromToken } = await import("@/lib/auth/session");
    const mine = createSessionToken("u", "mine");
    const adminId = sessionIdFromToken(createSessionToken("admin", "admin-laptop"))!;
    const res = await DELETE(
      reqWithCookie(`http://x/api/auth/sessions/${adminId}`, mine, "DELETE") as never,
      { params: Promise.resolve({ id: adminId }) },
    );
    expect(res.status).toBe(404);
    expect(getSession(adminId)).not.toBeNull();
  });

  it("revoke-others leaves other users signed in", async () => {
    const { POST } = await import("./revoke-others/route");
    const { getSession } = await import("@/lib/auth/sessions");
    const { sessionIdFromToken } = await import("@/lib/auth/session");
    const mine = createSessionToken("u", "keep");
    const myOther = sessionIdFromToken(createSessionToken("u", "drop"))!;
    const adminId = sessionIdFromToken(createSessionToken("admin", "admin-laptop"))!;
    await POST(reqWithCookie("http://x/api/auth/sessions/revoke-others", mine, "POST") as never);
    expect(getSession(myOther)).toBeNull();
    expect(getSession(adminId)).not.toBeNull();
  });

  it("no session cookie → 401", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/auth/sessions") as never);
    expect(res.status).toBe(401);
  });
});
