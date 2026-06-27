import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSessionToken, verifySessionToken, revokeSessionToken, sessionIdFromToken,
} from "./session";
import { _resetSessionCacheForTests } from "./sessions";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-tok-"));
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

describe("session token layer", () => {
  it("round-trips a created token", () => {
    const token = createSessionToken("Mozilla/Test");
    expect(verifySessionToken(token)).toBe(true);
    expect(sessionIdFromToken(token)).toBeTruthy();
  });

  it("rejects a tampered or empty token", () => {
    const token = createSessionToken("ua");
    expect(verifySessionToken(token + "x")).toBe(false);
    expect(verifySessionToken("garbage")).toBe(false);
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
  });

  it("revokes a token so it no longer verifies", () => {
    const token = createSessionToken("ua");
    expect(verifySessionToken(token)).toBe(true);
    revokeSessionToken(token);
    expect(verifySessionToken(token)).toBe(false);
  });

  it("rejects a well-signed id with no server record", () => {
    const token = createSessionToken("ua");
    const id = sessionIdFromToken(token)!;
    revokeSessionToken(token);
    expect(sessionIdFromToken(token)).toBe(id); // signature still valid
    expect(verifySessionToken(token)).toBe(false); // but record is gone
  });
});
