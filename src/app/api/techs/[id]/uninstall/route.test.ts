import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

import { GET } from "./route";

function makeReq(host: string) {
  return new Request(`http://${host}/api/techs/x/uninstall`, { headers: { host } }) as never;
}
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  return out;
}

beforeEach(() => {
  spawnMock.mockReset();
  delete process.env.BAKLAVA_DISABLE_DRIVER_INSTALL;
  (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.driverInstalls")] = new Set();
});

describe("uninstall route guards", () => {
  it("403 for a non-local host (no spawn)", async () => {
    const res = await GET(makeReq("evil.example.com"), ctx("postgres"));
    expect(res.status).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it("400 for an unknown tech (no spawn)", async () => {
    const res = await GET(makeReq("localhost:3000"), ctx("nope"));
    expect(res.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("uninstall route happy path", () => {
  it("spawns npm uninstall --no-save with the tech's deps and emits done", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    });
    spawnMock.mockReturnValue(child);
    const res = await GET(makeReq("localhost:3000"), ctx("postgres"));
    expect(spawnMock).toHaveBeenCalledWith("npm", ["uninstall", "pg", "pg-cursor", "--no-save"], expect.objectContaining({ cwd: expect.any(String) }));
    queueMicrotask(() => { child.stdout.emit("data", Buffer.from("removed 1 package\n")); child.emit("close", 0); });
    const body = await readAll(res);
    expect(body).toContain("event: progress");
    expect(body).toContain("event: done");
    expect(body).toContain("pg");
  });
  it("emits error on non-zero npm exit", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    });
    spawnMock.mockReturnValue(child);
    const res = await GET(makeReq("localhost:3000"), ctx("postgres"));
    queueMicrotask(() => { child.stderr.emit("data", Buffer.from("npm ERR! boom\n")); child.emit("close", 1); });
    const body = await readAll(res);
    expect(body).toContain("event: error");
  });
});

describe("uninstall route shares the in-flight guard with install", () => {
  it("409 when an operation for the tech is already in progress", async () => {
    (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.driverInstalls")] = new Set(["postgres"]);
    const res = await GET(makeReq("localhost:3000"), ctx("postgres"));
    expect(res.status).toBe(409);
    expect(spawnMock).not.toHaveBeenCalled();
    (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.driverInstalls")] = new Set();
  });
});
