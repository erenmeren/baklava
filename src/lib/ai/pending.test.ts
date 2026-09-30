import { describe, it, expect, vi, afterEach } from "vitest";
import { createPending, dropPending, resolvePending, PENDING_TTL_MS } from "./pending";

afterEach(() => vi.useRealTimers());

describe("pending approvals", () => {
  it("resolves a waiting promise when its owner decides", async () => {
    const p = createPending("s1", "call1", { userId: "u" });
    queueMicrotask(() => resolvePending("s1", "call1", true, { userId: "u" }));
    await expect(p).resolves.toBe(true);
  });

  it("resolving an unknown key is a no-op", () => {
    expect(resolvePending("s1", "missing", true, { userId: "u" })).toEqual({ ok: false, error: "not-found" });
  });

  it("another user can't decide it — it stays pending for the owner", async () => {
    const p = createPending("s2", "call", { userId: "owner" });
    expect(resolvePending("s2", "call", true, { userId: "intruder" })).toEqual({ ok: false, error: "not-found" });
    expect(resolvePending("s2", "call", false, { userId: "owner" })).toEqual({ ok: true });
    await expect(p).resolves.toBe(false);
  });

  it("a high-risk approval needs the typed confirmation, server-side", async () => {
    const p = createPending("s3", "call", { userId: "u", confirm: "prod-db" });
    expect(resolvePending("s3", "call", true, { userId: "u" })).toEqual({
      ok: false,
      error: "confirmation-required",
    });
    expect(resolvePending("s3", "call", true, { userId: "u", confirm: "staging" }).ok).toBe(false);
    expect(resolvePending("s3", "call", true, { userId: "u", confirm: " prod-db " })).toEqual({ ok: true });
    await expect(p).resolves.toBe(true);
  });

  it("rejecting a high-risk action needs no confirmation", async () => {
    const p = createPending("s4", "call", { userId: "u", confirm: "prod-db" });
    expect(resolvePending("s4", "call", false, { userId: "u" })).toEqual({ ok: true });
    await expect(p).resolves.toBe(false);
  });

  it("dropPending declines everything left in the session", async () => {
    const a = createPending("s5", "a", { userId: "u" });
    const b = createPending("s5", "b", { userId: "u" });
    const other = createPending("s6", "c", { userId: "u" });
    dropPending("s5");
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);
    expect(resolvePending("s5", "a", true, { userId: "u" }).ok).toBe(false);
    resolvePending("s6", "c", true, { userId: "u" });
    await expect(other).resolves.toBe(true);
  });

  it("an unanswered approval is declined after the TTL", async () => {
    vi.useFakeTimers();
    const p = createPending("s7", "call", { userId: "u" });
    vi.advanceTimersByTime(PENDING_TTL_MS + 1);
    await expect(p).resolves.toBe(false);
  });
});
