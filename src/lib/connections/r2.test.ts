import { describe, it, expect } from "vitest";
import {
  validateBucketName,
  validateObjectKey,
  endpointFor,
  splitKey,
  joinPrefix,
} from "./r2";

describe("validateBucketName", () => {
  it("accepts valid names", () => {
    expect(() => validateBucketName("ditto-receipts")).not.toThrow();
    expect(() => validateBucketName("my-bucket-123")).not.toThrow();
  });
  it("rejects too short / too long", () => {
    expect(() => validateBucketName("ab")).toThrow();
    expect(() => validateBucketName("a".repeat(64))).toThrow();
  });
  it("rejects uppercase, spaces, underscores", () => {
    expect(() => validateBucketName("MyBucket")).toThrow();
    expect(() => validateBucketName("my bucket")).toThrow();
    expect(() => validateBucketName("my_bucket")).toThrow();
  });
  it("rejects names not starting/ending alphanumeric", () => {
    expect(() => validateBucketName("-bucket")).toThrow();
    expect(() => validateBucketName("bucket-")).toThrow();
  });
  it("rejects consecutive dots and IP-shaped names", () => {
    expect(() => validateBucketName("a..b")).toThrow();
    expect(() => validateBucketName("192.168.0.1")).toThrow();
  });
});

describe("validateObjectKey", () => {
  it("accepts normal keys", () => {
    expect(() => validateObjectKey("a/b/c.txt")).not.toThrow();
    expect(() => validateObjectKey("photo.jpg")).not.toThrow();
  });
  it("rejects empty and traversal", () => {
    expect(() => validateObjectKey("")).toThrow();
    expect(() => validateObjectKey("../etc/passwd")).toThrow();
    expect(() => validateObjectKey("a/../../b")).toThrow();
  });
});

describe("endpointFor", () => {
  it("builds the R2 endpoint from account id", () => {
    expect(endpointFor("abc123")).toBe(
      "https://abc123.r2.cloudflarestorage.com",
    );
  });
});

describe("splitKey", () => {
  it("splits a key into prefix folders and basename", () => {
    expect(splitKey("a/b/c.txt")).toEqual({
      folders: ["a", "b"],
      name: "c.txt",
    });
    expect(splitKey("file.txt")).toEqual({ folders: [], name: "file.txt" });
  });
});

describe("joinPrefix", () => {
  it("joins a prefix and a name with a single slash", () => {
    expect(joinPrefix("a/b/", "c.txt")).toBe("a/b/c.txt");
    expect(joinPrefix("", "c.txt")).toBe("c.txt");
    expect(joinPrefix("a/b", "c.txt")).toBe("a/b/c.txt");
  });
});
