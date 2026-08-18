import { describe, it, expect } from "vitest";
import { ALL_NAMESPACES, resolveNamespace } from "./namespace";

describe("resolveNamespace", () => {
  it("uses the connection's configured namespace when the URL says nothing", () => {
    expect(resolveNamespace(undefined, "payments")).toBe("payments");
  });

  it("falls back to all namespaces when neither is set", () => {
    expect(resolveNamespace(undefined, undefined)).toBe(ALL_NAMESPACES);
  });

  it("lets the URL override the configured namespace", () => {
    expect(resolveNamespace("billing", "payments")).toBe("billing");
  });

  it("lets the URL widen a configured namespace back to all", () => {
    expect(resolveNamespace("*", "payments")).toBe(ALL_NAMESPACES);
  });

  it("treats an empty or whitespace-only param as absent", () => {
    expect(resolveNamespace("", "payments")).toBe("payments");
    expect(resolveNamespace("   ", "payments")).toBe("payments");
    expect(resolveNamespace("   ", undefined)).toBe(ALL_NAMESPACES);
  });

  it("takes the first value when the param is repeated", () => {
    expect(resolveNamespace(["billing", "payments"], undefined)).toBe("billing");
  });

  it("ignores a configured namespace that is only whitespace", () => {
    expect(resolveNamespace(undefined, "  ")).toBe(ALL_NAMESPACES);
  });

  it("trims surrounding whitespace off the chosen namespace", () => {
    expect(resolveNamespace(" billing ", undefined)).toBe("billing");
  });
});
