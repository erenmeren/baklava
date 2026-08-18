import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { NextRequest } from "next/server";
import {
  registerSession,
  getSession,
  dropConnectionSessions,
} from "@/lib/connections/terminal-sessions";
import { DELETE as deleteSession } from "./[id]/containers/[cid]/terminal/[sid]/route";
import { GET as streamSession } from "./[id]/containers/[cid]/terminal/[sid]/stream/route";
import { POST as inputSession } from "./[id]/containers/[cid]/terminal/[sid]/input/route";
import { POST as resizeSession } from "./[id]/containers/[cid]/terminal/[sid]/resize/route";

/**
 * Same boundary as the k8s exec routes: `src/proxy.ts` only checks that the
 * caller may reach the connection named in the *path*, so a session id from
 * another connection must read as "not found" — otherwise access to one
 * Docker host hands over every other host's live terminals.
 */
const resize = vi.fn(async () => ({}));

function makeSession(connectionId: string, containerId = "abc123") {
  const stream = new PassThrough();
  const session = registerSession({
    connectionId,
    containerId,
    exec: { resize, inspect: async () => ({ ExitCode: 0 }) },
    stream,
  });
  return { session, stream };
}

function ctx(id: string, sid: string, cid = "abc123") {
  return { params: Promise.resolve({ id, cid, sid }) };
}

function req(init: RequestInit = {}, signal?: AbortSignal): NextRequest {
  return new Request("http://localhost", { ...init, signal }) as NextRequest;
}

describe("docker terminal-session routes are scoped to their own connection", () => {
  beforeEach(() => {
    resize.mockClear();
    dropConnectionSessions("conn-a");
    dropConnectionSessions("conn-b");
  });
  afterEach(() => {
    dropConnectionSessions("conn-a");
    dropConnectionSessions("conn-b");
  });

  it("refuses to write stdin into another connection's terminal", async () => {
    const { session, stream } = makeSession("conn-a");
    const written: Buffer[] = [];
    stream.on("data", (c: Buffer) => written.push(c));

    const res = await inputSession(
      req({ method: "POST", body: JSON.stringify({ data: "rm -rf /\n" }) }),
      ctx("conn-b", session.id),
    );

    expect(res.status).toBe(404);
    await new Promise((r) => setImmediate(r));
    expect(Buffer.concat(written).toString()).toBe("");
  });

  it("accepts stdin from the session's own connection", async () => {
    const { session, stream } = makeSession("conn-a");
    const written: Buffer[] = [];
    stream.on("data", (c: Buffer) => written.push(c));

    const res = await inputSession(
      req({ method: "POST", body: JSON.stringify({ data: "ls\n" }) }),
      ctx("conn-a", session.id),
    );

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(Buffer.concat(written).toString()).toBe("ls\n");
  });

  it("refuses to resize another connection's terminal", async () => {
    const { session } = makeSession("conn-a");

    const res = await resizeSession(
      req({ method: "POST", body: JSON.stringify({ cols: 200, rows: 50 }) }),
      ctx("conn-b", session.id),
    );

    expect(res.status).toBe(404);
    expect(resize).not.toHaveBeenCalled();
  });

  it("resizes from the session's own connection", async () => {
    const { session } = makeSession("conn-a");

    const res = await resizeSession(
      req({ method: "POST", body: JSON.stringify({ cols: 200, rows: 50 }) }),
      ctx("conn-a", session.id),
    );

    expect(res.status).toBe(200);
    expect(resize).toHaveBeenCalledWith({ h: 50, w: 200 });
  });

  it("refuses to stream another connection's terminal output", async () => {
    const { session } = makeSession("conn-a");
    const ac = new AbortController();
    const res = await streamSession(req({}, ac.signal), ctx("conn-b", session.id));
    ac.abort();
    expect(res.status).toBe(404);
  });

  it("streams the session's own connection", async () => {
    const { session } = makeSession("conn-a");
    const ac = new AbortController();
    const res = await streamSession(req({}, ac.signal), ctx("conn-a", session.id));
    expect(res.status).toBe(200);
    ac.abort();
    await res.body?.cancel().catch(() => {});
  });

  it("refuses to kill another connection's terminal", async () => {
    const { session } = makeSession("conn-a");

    const res = await deleteSession(req({ method: "DELETE" }), ctx("conn-b", session.id));

    expect(res.status).toBe(404);
    expect(getSession(session.id)).toBeDefined();
  });

  it("kills the terminal from its own connection", async () => {
    const { session } = makeSession("conn-a");

    const res = await deleteSession(req({ method: "DELETE" }), ctx("conn-a", session.id));

    expect(res.status).toBe(200);
    expect(getSession(session.id)).toBeUndefined();
  });

  it("refuses a session id addressed through a different container", async () => {
    const { session } = makeSession("conn-a", "abc123");

    const res = await inputSession(
      req({ method: "POST", body: JSON.stringify({ data: "ls\n" }) }),
      ctx("conn-a", session.id, "other-container"),
    );

    expect(res.status).toBe(404);
  });
});

describe("docker terminal session ids", () => {
  afterEach(() => dropConnectionSessions("conn-a"));

  it("are crypto-random, not Math.random + Date.now", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(makeSession("conn-a").session.id);
    expect(ids.size).toBe(5);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
