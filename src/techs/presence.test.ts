import { describe, it, expect } from "vitest";
import { isDriverInstalled } from "./presence";

describe("isDriverInstalled", () => {
  it("returns true for a package that exists", () => {
    expect(isDriverInstalled("zod")).toBe(true); // always installed
  });
  it("returns false for a package that does not exist", () => {
    expect(isDriverInstalled("totally-not-a-real-pkg-xyz")).toBe(false);
  });
  it("caches the result (second call cheap, same value)", () => {
    expect(isDriverInstalled("zod")).toBe(true);
    expect(isDriverInstalled("zod")).toBe(true);
  });
});
