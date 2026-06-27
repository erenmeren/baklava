import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSession, verifySession, revokeSession, revokeAllExcept, listSessions,
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
    const rec = createSession("Mozilla/Test");
    expect(rec.id).toBeTruthy();
    expect(verifySession(rec.id)).toBe(true);
    const file = path.join(dir, "sessions.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("rejects an unknown id", () => {
    expect(verifySession("nope")).toBe(false);
  });

  it("expires after the idle window and deletes the record", () => {
    const now = 1_000_000_000_000;
    const rec = createSession("ua", now);
    const later = now + 7 * 24 * 60 * 60 * 1000 + 1;
    expect(verifySession(rec.id, later)).toBe(false);
    expect(verifySession(rec.id, later)).toBe(false);
  });

  it("enforces the 30-day absolute cap even with activity", () => {
    const now = 1_000_000_000_000;
    const rec = createSession("ua", now);
    let t = now;
    for (let i = 0; i < 5; i++) {
      t += 6 * 24 * 60 * 60 * 1000;
      verifySession(rec.id, t);
    }
    const past30 = now + 30 * 24 * 60 * 60 * 1000 + 1;
    expect(verifySession(rec.id, past30)).toBe(false);
  });

  it("revokes one and all-except", () => {
    const a = createSession("a");
    const b = createSession("b");
    const c = createSession("c");
    revokeSession(a.id);
    expect(verifySession(a.id)).toBe(false);
    expect(verifySession(b.id)).toBe(true);
    revokeAllExcept(c.id);
    expect(verifySession(b.id)).toBe(false);
    expect(verifySession(c.id)).toBe(true);
  });

  it("lists active sessions newest-first", () => {
    const now = 1_000_000_000_000;
    createSession("old", now);
    createSession("new", now + 1000);
    const list = listSessions(now + 2000);
    expect(list.map((r) => r.userAgent)).toEqual(["new", "old"]);
  });
});
