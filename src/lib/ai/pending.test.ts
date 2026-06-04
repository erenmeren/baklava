import { describe, it, expect } from "vitest";
import { createPending, resolvePending } from "./pending";

describe("pending approvals", () => {
  it("resolves a waiting promise when the decision arrives", async () => {
    const p = createPending("s1", "call1");
    queueMicrotask(() => resolvePending("s1", "call1", true));
    await expect(p).resolves.toBe(true);
  });

  it("resolving an unknown key is a no-op (returns false)", () => {
    expect(resolvePending("s1", "missing", true)).toBe(false);
  });
});
