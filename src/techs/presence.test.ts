import { describe, it, expect } from "vitest";
import { isDriverInstalled, modulesInstalled } from "./presence";
import { postgres } from "./postgres";

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

describe("modulesInstalled", () => {
  it("modulesInstalled true when all deps present", () => {
    expect(modulesInstalled(postgres)).toBe(true); // pg installed in dev
  });
  it("modulesInstalled false when a dep is missing", () => {
    expect(
      modulesInstalled({ optionalDeps: ["totally-not-real-pkg-xyz"] } as never),
    ).toBe(false);
  });
});
