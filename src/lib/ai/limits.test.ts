import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, DEFAULT_LIMITS, _resetLimitsForTests, type LimitConfig } from "./limits";

beforeEach(() => _resetLimitsForTests());

const cfg: LimitConfig = {
  sessionBudget: 5,
  rateWindowMs: 1000,
  rateMax: 3,
  destructiveWindowMs: 1000,
  destructiveMax: 2,
};

describe("checkRateLimit", () => {
  it("allows reads up to the rate cap then blocks within the window", () => {
    const base = { sessionId: "s", userId: "u", connectionId: "c", category: "read" as const, config: cfg };
    expect(checkRateLimit({ ...base, now: 0 }).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: 10 }).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: 20 }).allowed).toBe(true);
    const blocked = checkRateLimit({ ...base, now: 30 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/rate/i);
    expect(checkRateLimit({ ...base, now: 1100 }).allowed).toBe(true);
  });

  it("trips the destructive breaker independent of the overall rate", () => {
    const base = { sessionId: "s2", userId: "u2", connectionId: "c", category: "destructive" as const, config: cfg };
    expect(checkRateLimit({ ...base, now: 0 }).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: 10 }).allowed).toBe(true);
    const tripped = checkRateLimit({ ...base, now: 20 });
    expect(tripped.allowed).toBe(false);
    expect(tripped.reason).toMatch(/destructive/i);
  });

  it("enforces the per-session budget across connections", () => {
    let n = 0;
    const fire = (conn: string) =>
      checkRateLimit({ sessionId: "s3", userId: "u3", connectionId: conn, category: "read", now: (n += 1) * 1000, config: cfg });
    for (let i = 0; i < 5; i++) expect(fire(`c${i}`).allowed).toBe(true);
    const over = fire("c6");
    expect(over.allowed).toBe(false);
    expect(over.reason).toMatch(/budget/i);
  });

  it("scopes the rate window per user+connection", () => {
    const a = { sessionId: "sA", userId: "uA", connectionId: "c", category: "read" as const, config: cfg };
    const b = { sessionId: "sB", userId: "uB", connectionId: "c", category: "read" as const, config: cfg };
    for (let i = 0; i < 3; i++) expect(checkRateLimit({ ...a, now: i }).allowed).toBe(true);
    expect(checkRateLimit({ ...a, now: 4 }).allowed).toBe(false);
    expect(checkRateLimit({ ...b, now: 4 }).allowed).toBe(true);
  });

  it("a new session doesn't reset the user's rate window or destructive breaker", () => {
    const d = (sessionId: string, now: number) =>
      checkRateLimit({ sessionId, userId: "same", connectionId: "c", category: "destructive", now, config: cfg });
    expect(d("turn-1", 0).allowed).toBe(true);
    expect(d("turn-2", 1).allowed).toBe(true);
    const tripped = d("turn-3", 2);
    expect(tripped.allowed).toBe(false);
    expect(tripped.reason).toMatch(/destructive|rate/i);
  });

  it("has sane defaults", () => {
    expect(DEFAULT_LIMITS.sessionBudget).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.destructiveMax).toBeGreaterThan(0);
  });
});
