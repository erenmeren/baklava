import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getGrants,
  setGrants,
  dropConnectionGrants,
  effectiveAccess,
  _resetAccessCacheForTests,
} from "./access";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-access-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  _resetAccessCacheForTests();
  // store has its own globalThis cache — clear it so each test starts empty
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
});

const admin = { id: "u-admin", role: "admin" as const };
const member = { id: "u-member", role: "member" as const };
const other = { id: "u-other", role: "member" as const };

describe("effectiveAccess", () => {
  it("admin always gets write", () => {
    expect(effectiveAccess({ user: admin, conn: { id: "c1" } })).toBe("write");
    expect(effectiveAccess({ user: admin, conn: { id: "c1", ownerId: "someone" } })).toBe("write");
  });

  it("owner gets write", () => {
    expect(effectiveAccess({ user: member, conn: { id: "c1", ownerId: member.id } })).toBe("write");
  });

  it("granted read/write resolves from grant map", () => {
    setGrants("c1", { [member.id]: "read", [other.id]: "write" });
    expect(effectiveAccess({ user: member, conn: { id: "c1" } })).toBe("read");
    expect(effectiveAccess({ user: other, conn: { id: "c1" } })).toBe("write");
  });

  it("no grant, not owner, not admin → none", () => {
    expect(effectiveAccess({ user: member, conn: { id: "c1" } })).toBe("none");
    expect(effectiveAccess({ user: member, conn: { id: "c1", ownerId: other.id } })).toBe("none");
  });
});

describe("grants round-trip", () => {
  it("setGrants then getGrants returns the map", () => {
    setGrants("c1", { [member.id]: "read", [other.id]: "write" });
    expect(getGrants("c1")).toEqual({ [member.id]: "read", [other.id]: "write" });
  });

  it("getGrants returns empty object for unknown connection", () => {
    expect(getGrants("nope")).toEqual({});
  });

  it("setGrants replaces the whole map (no merge)", () => {
    setGrants("c1", { [member.id]: "read", [other.id]: "write" });
    setGrants("c1", { [member.id]: "write" });
    expect(getGrants("c1")).toEqual({ [member.id]: "write" });
  });

  it("setGrants drops entries that aren't read/write", () => {
    setGrants("c1", {
      [member.id]: "read",
      [other.id]: "" as unknown as "read",
      "x": undefined as unknown as "read",
    });
    expect(getGrants("c1")).toEqual({ [member.id]: "read" });
  });

  it("persists encrypted at rest, 0600", () => {
    setGrants("c1", { [member.id]: "read" });
    const file = path.join(dir, "connection-access.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const raw = fs.readFileSync(file, "utf8");
    // encrypted envelope — must not contain plaintext userId
    expect(raw).not.toContain(member.id);
  });

  it("survives a cache reset (reads back from disk)", () => {
    setGrants("c1", { [member.id]: "write" });
    _resetAccessCacheForTests();
    expect(getGrants("c1")).toEqual({ [member.id]: "write" });
  });
});

describe("dropConnectionGrants", () => {
  it("removes all grants for a connection", () => {
    setGrants("c1", { [member.id]: "read" });
    setGrants("c2", { [other.id]: "write" });
    dropConnectionGrants("c1");
    expect(getGrants("c1")).toEqual({});
    expect(getGrants("c2")).toEqual({ [other.id]: "write" });
  });
});
