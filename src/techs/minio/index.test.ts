import { describe, it, expect } from "vitest";
import { minio } from "./index";

describe("minio module", () => {
  it("declares id and optionalDeps", () => {
    expect(minio.id).toBe("minio");
    expect(minio.optionalDeps).toEqual([
      "@aws-sdk/client-s3",
      "@aws-sdk/lib-storage",
      "@aws-sdk/s3-request-presigner",
    ]);
    expect(minio.catalog.id).toBe("minio");
  });
  it("summarises a connection record", () => {
    const summary = minio.summary({
      id: "x", tech: "minio", name: "n", status: "ok", createdAt: 0,
      config: { endpoint: "localhost:9000", useSSL: false, accessKey: "ak", secretKey: "sk", region: "us-east-1" },
    });
    expect(summary).toBe("ak@localhost:9000");
  });
  it("exposes secret keys and a probe", () => {
    expect(minio.config.secretKeys).toContain("secretKey");
    expect(typeof minio.driver.probe).toBe("function");
  });
});
