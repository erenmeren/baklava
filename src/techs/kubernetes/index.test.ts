import { describe, it, expect } from "vitest";
import { kubernetes } from "./index";

describe("kubernetes module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(kubernetes.id).toBe("kubernetes");
    expect(kubernetes.optionalDeps).toEqual(["@kubernetes/client-node"]);
    expect(kubernetes.catalog.id).toBe("kubernetes");
    expect(kubernetes.serverPackages).toEqual(["@kubernetes/client-node"]);
  });
  it("summarises a connection record", () => {
    const summary = kubernetes.summary({
      id: "x", tech: "kubernetes", name: "n", status: "ok", createdAt: 0,
      config: { source: "path", kubeconfigPath: "/p" },
    });
    expect(summary).toBe("/p");
  });
  it("exposes secret keys and a probe", () => {
    expect(kubernetes.config.secretKeys).toContain("kubeconfigYaml");
    expect(typeof kubernetes.driver.probe).toBe("function");
  });
});
