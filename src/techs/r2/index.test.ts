import { describe, it, expect } from "vitest";
import { r2 } from "./index";

describe("r2 module", () => {
  it("declares id and optionalDeps", () => {
    expect(r2.id).toBe("r2");
    expect(r2.optionalDeps).toEqual([
      "@aws-sdk/client-s3",
      "@aws-sdk/lib-storage",
      "@aws-sdk/s3-request-presigner",
    ]);
    expect(r2.catalog.id).toBe("r2");
  });
  it("summarises a connection record", () => {
    const summary = r2.summary({
      id: "x", tech: "r2", name: "n", status: "ok", createdAt: 0,
      config: { accountId: "acc", accessKeyId: "ak", secretAccessKey: "sk" },
    });
    expect(summary).toBe("ak@acc.r2");
  });
  it("exposes secret keys and a probe", () => {
    expect(r2.config.secretKeys).toContain("secretAccessKey");
    expect(typeof r2.driver.probe).toBe("function");
  });
});
