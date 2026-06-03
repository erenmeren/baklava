import { describe, it, expect } from "vitest";
import { computeRecent } from "./recent";

describe("computeRecent", () => {
  it("puts the newest id first and dedupes", () => {
    expect(computeRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(computeRecent(["a", "b"], "b")).toEqual(["b", "a"]);
  });
  it("caps the list length", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `id${i}`);
    const out = computeRecent(ten, "new", 8);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe("new");
  });
});
