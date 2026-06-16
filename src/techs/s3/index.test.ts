import { describe, it, expect } from "vitest";
import { s3 } from "./index";

describe("s3 module", () => {
  it("declares id and optionalDeps", () => {
    expect(s3.id).toBe("s3");
    expect(s3.optionalDeps).toEqual([
      "@aws-sdk/client-s3",
      "@aws-sdk/lib-storage",
      "@aws-sdk/s3-request-presigner",
    ]);
    expect(s3.catalog.id).toBe("s3");
  });
  it("summarises a connection record", () => {
    const summary = s3.summary({
      id: "x", tech: "s3", name: "n", status: "ok", createdAt: 0,
      config: { region: "us-east-1", accessKeyId: "ak", secretAccessKey: "sk" },
    });
    expect(summary).toBe("ak@s3.us-east-1");
  });
  it("exposes secret keys and a probe", () => {
    expect(s3.config.secretKeys).toContain("secretAccessKey");
    expect(s3.config.secretKeys).toContain("sessionToken");
    expect(typeof s3.driver.probe).toBe("function");
  });
});
