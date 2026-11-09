import { describe, it, expect } from "vitest";
import { endpointFor } from "./s3-aws";

describe("endpointFor", () => {
  it("builds the regional S3 endpoint", () => {
    expect(endpointFor("us-east-1")).toBe("https://s3.us-east-1.amazonaws.com");
    expect(endpointFor("eu-west-2")).toBe("https://s3.eu-west-2.amazonaws.com");
  });
});

// The region becomes part of the endpoint host; anything but a DNS label lets
// it pick the host (`evil.com/x?` → https://s3.evil.com/x?.amazonaws.com).
describe("region validation", () => {
  it("endpointFor refuses a region that isn't a plain label", () => {
    expect(() => endpointFor("evil.com/x?")).toThrow(/region/i);
    expect(() => endpointFor("us-east-1.evil.com#")).toThrow(/region/i);
  });

  it("s3AwsClientFor refuses it before building a client", async () => {
    const { s3AwsClientFor } = await import("./s3-aws");
    await expect(
      s3AwsClientFor("t", { region: "evil.com/x?", accessKeyId: "a", secretAccessKey: "s" }),
    ).rejects.toThrow(/region/i);
  });

  it("the config schema refuses it", async () => {
    const { s3Meta } = await import("@/techs/s3/meta");
    expect(s3Meta.config.schema.safeParse({ region: "evil.com/x?", accessKeyId: "a", secretAccessKey: "s" }).success).toBe(false);
    expect(s3Meta.config.schema.safeParse({ region: "eu-west-2", accessKeyId: "a", secretAccessKey: "s" }).success).toBe(true);
  });
});
