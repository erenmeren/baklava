import { describe, it, expect } from "vitest";
import { endpointFor } from "./s3-aws";

describe("endpointFor", () => {
  it("builds the regional S3 endpoint", () => {
    expect(endpointFor("us-east-1")).toBe("https://s3.us-east-1.amazonaws.com");
    expect(endpointFor("eu-west-2")).toBe("https://s3.eu-west-2.amazonaws.com");
  });
});
