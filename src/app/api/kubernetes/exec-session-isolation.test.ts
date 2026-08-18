import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import type { NextRequest } from "next/server";
import {
  registerExecSession,
  getExecSession,
  dropConnectionExecSessions,
} from "@/lib/connections/kubernetes-sessions";
import { DELETE as deleteSession } from "./[id]/exec/[sid]/route";
import { GET as streamSession } from "./[id]/exec/[sid]/stream/route";
import { POST as inputSession } from "./[id]/exec/[sid]/input/route";

/**
 * The exec-session routes are namespaced under a connection id
 * (`/api/kubernetes/<id>/exec/<sid>/…`) and `src/proxy.ts` only checks that
 * the caller may reach the connection named in the *path*. Nothing else
 * ties `<sid>` to `<id>`, so a member with access to connection A must not
 * be able to reach a session that belongs to connection B by pointing A's
 * URL at B's session id.
 */
function makeSession(connectionId: string) {
  const stdin = new PassThrough();
  const output = new PassThrough();
  let closed = false;
  const session = registerExecSession({
    connectionId,
    namespace: "default",
    podName: "api-0",
    stdin,
    output,
    // The session only ever stores `ws`; the close path goes through `close`.
    ws: {} as never,
    close: () => {
      closed = true;
      output.end();
    },
  });
  return { session, stdin, output, wasClosed: () => closed };
}

function ctx(id: string, sid: string) {
  return { params: Promise.resolve({ id, sid }) };
}

function req(init: RequestInit = {}, signal?: AbortSignal): NextRequest {
  return new Request("http://localhost", { ...init, signal }) as NextRequest;
}

describe("k8s exec-session routes are scoped to their own connection", () => {
  beforeEach(() => {
    dropConnectionExecSessions("conn-a");
    dropConnectionExecSessions("conn-b");
  });
  afterEach(() => {
    dropConnectionExecSessions("conn-a");
    dropConnectionExecSessions("conn-b");
  });

  it("refuses to write stdin into another connection's session", async () => {
    const { session, stdin } = makeSession("conn-a");
    const written: Buffer[] = [];
    stdin.on("data", (c: Buffer) => written.push(c));

    const res = await inputSession(
      req({ method: "POST", body: JSON.stringify({ data: Buffer.from("rm -rf /\n").toString("base64") }) }),
      ctx("conn-b", session.id),
    );

    expect(res.status).toBe(404);
    await new Promise((r) => setImmediate(r));
    expect(Buffer.concat(written).toString()).toBe("");
  });

  it("accepts stdin from the session's own connection", async () => {
    const { session, stdin } = makeSession("conn-a");
    const written: Buffer[] = [];
    stdin.on("data", (c: Buffer) => written.push(c));

    const res = await inputSession(
      req({ method: "POST", body: JSON.stringify({ data: Buffer.from("ls\n").toString("base64") }) }),
      ctx("conn-a", session.id),
    );

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(Buffer.concat(written).toString()).toBe("ls\n");
  });

  it("refuses to stream another connection's session output", async () => {
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

  it("refuses to kill another connection's session", async () => {
    const { session, wasClosed } = makeSession("conn-a");

    const res = await deleteSession(req({ method: "DELETE" }), ctx("conn-b", session.id));

    expect(res.status).toBe(404);
    expect(wasClosed()).toBe(false);
    expect(getExecSession(session.id)).toBeDefined();
  });

  it("kills the session from its own connection", async () => {
    const { session, wasClosed } = makeSession("conn-a");

    const res = await deleteSession(req({ method: "DELETE" }), ctx("conn-a", session.id));

    expect(res.status).toBe(200);
    expect(wasClosed()).toBe(true);
    expect(getExecSession(session.id)).toBeUndefined();
  });
});

describe("k8s exec session ids", () => {
  afterEach(() => dropConnectionExecSessions("conn-a"));

  it("are not derived from Math.random/Date.now (guessable within a run)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(makeSession("conn-a").session.id);
    expect(ids.size).toBe(5);
    // A crypto-random id: at least 128 bits of hex/uuid, not an 8-char base36
    // slice of Math.random() plus a predictable Date.now() suffix.
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
