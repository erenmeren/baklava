import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSession, verifySession, getSession, revokeSession, revokeAllExcept,
  revokeUserSessions, listSessions,
  _resetSessionCacheForTests,
} from "./sessions";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-sess-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  _resetSessionCacheForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
});

describe("sessions store", () => {
  it("creates and verifies a session, persisted 0600", () => {
    const rec = createSession("user-1", "Mozilla/Test");
    expect(rec.id).toBeTruthy();
    expect(verifySession(rec.id)).toBe(true);
    const file = path.join(dir, "sessions.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("stores the userId on the record", () => {
    const rec = createSession("user-42", "ua");
    expect(rec.userId).toBe("user-42");
  });

  it("getSession returns the active record incl userId, null when expired", () => {
    const now = 1_000_000_000_000;
    const rec = createSession("user-7", "ua", now);
    const got = getSession(rec.id, now + 1000);
    expect(got).not.toBeNull();
    expect(got!.userId).toBe("user-7");
    expect(got!.id).toBe(rec.id);
    const later = now + 1000 + 7 * 24 * 60 * 60 * 1000 + 1; // past idle window (from slid lastSeenAt)
    expect(getSession(rec.id, later)).toBeNull();
    expect(getSession("nope")).toBeNull();
  });

  it("revokeUserSessions removes only that user's sessions", () => {
    const a = createSession("user-a", "a1");
    const b = createSession("user-a", "a2");
    const c = createSession("user-b", "b1");
    revokeUserSessions("user-a");
    expect(verifySession(a.id)).toBe(false);
    expect(verifySession(b.id)).toBe(false);
    expect(verifySession(c.id)).toBe(true);
  });

  it("defaults userId to empty string for records loaded without one", () => {
    const file = path.join(dir, "sessions.json");
    const now = Date.now();
    fs.writeFileSync(
      file,
      JSON.stringify([
        { id: "legacy", createdAt: now, lastSeenAt: now, expiresAt: now + 1e10, userAgent: "old" },
      ]),
    );
    _resetSessionCacheForTests();
    const got = getSession("legacy");
    expect(got).not.toBeNull();
    expect(got!.userId).toBe("");
  });

  it("rejects an unknown id", () => {
    expect(verifySession("nope")).toBe(false);
  });

  it("expires after the idle window and deletes the record", () => {
    const now = 1_000_000_000_000;
    const rec = createSession("u", "ua", now);
    const later = now + 7 * 24 * 60 * 60 * 1000 + 1;
    expect(verifySession(rec.id, later)).toBe(false);
    expect(verifySession(rec.id, later)).toBe(false);
  });

  it("enforces the 30-day absolute cap even with activity", () => {
    const now = 1_000_000_000_000;
    const rec = createSession("u", "ua", now);
    let t = now;
    for (let i = 0; i < 5; i++) {
      t += 6 * 24 * 60 * 60 * 1000;
      verifySession(rec.id, t);
    }
    const past30 = now + 30 * 24 * 60 * 60 * 1000 + 1;
    expect(verifySession(rec.id, past30)).toBe(false);
  });

  it("revokes one and all-except", () => {
    const a = createSession("u", "a");
    const b = createSession("u", "b");
    const c = createSession("u", "c");
    revokeSession(a.id);
    expect(verifySession(a.id)).toBe(false);
    expect(verifySession(b.id)).toBe(true);
    revokeAllExcept(c.id);
    expect(verifySession(b.id)).toBe(false);
    expect(verifySession(c.id)).toBe(true);
  });

  it("lists active sessions newest-first", () => {
    const now = 1_000_000_000_000;
    createSession("u", "old", now);
    createSession("u", "new", now + 1000);
    const list = listSessions(now + 2000);
    expect(list.map((r) => r.userAgent)).toEqual(["new", "old"]);
  });

  it("prunes expired records from disk on list and create", () => {
    const now = 1_000_000_000_000;
    createSession("u", "ghost", now);
    const past = now + 30 * 24 * 60 * 60 * 1000 + 1; // beyond absolute cap
    expect(listSessions(past)).toHaveLength(0);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dir, "sessions.json"), "utf8"),
    ) as unknown[];
    expect(onDisk).toHaveLength(0);
    createSession("u", "fresh", past);
    const after = JSON.parse(
      fs.readFileSync(path.join(dir, "sessions.json"), "utf8"),
    ) as Array<{ userAgent: string }>;
    expect(after.map((r) => r.userAgent)).toEqual(["fresh"]);
  });
});
