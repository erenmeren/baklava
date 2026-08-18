import { describe, it, expect } from "vitest";
import { proxyTarget } from "./proxy-target";

describe("proxyTarget", () => {
  it("addresses the pod's port the way the apiserver proxy expects", () => {
    expect(proxyTarget("storefront-abc", 80, "/")).toEqual({
      name: "storefront-abc:80",
      path: "/",
    });
  });

  it("accepts a named port", () => {
    expect(proxyTarget("api-0", "http", "/healthz").name).toBe("api-0:http");
  });

  it("accepts a numeric port given as a string", () => {
    expect(proxyTarget("api-0", "8080", "/").name).toBe("api-0:8080");
  });

  it("defaults an empty path to root", () => {
    expect(proxyTarget("api-0", 80, "").path).toBe("/");
    expect(proxyTarget("api-0", 80, "   ").path).toBe("/");
  });

  it("adds the leading slash a user will forget", () => {
    expect(proxyTarget("api-0", 80, "healthz").path).toBe("/healthz");
  });

  it("keeps a query string", () => {
    expect(proxyTarget("api-0", 80, "/metrics?format=json").path).toBe("/metrics?format=json");
  });

  it("rejects a port outside the valid range", () => {
    expect(() => proxyTarget("api-0", 0, "/")).toThrow(/port/i);
    expect(() => proxyTarget("api-0", 70000, "/")).toThrow(/port/i);
    expect(() => proxyTarget("api-0", -1, "/")).toThrow(/port/i);
  });

  it("rejects a port that is neither a number nor a DNS label", () => {
    expect(() => proxyTarget("api-0", "80/../../secret", "/")).toThrow(/port/i);
    expect(() => proxyTarget("api-0", "", "/")).toThrow(/port/i);
  });

  it("rejects a pod name that could escape the path segment", () => {
    expect(() => proxyTarget("../../nodes/x", 80, "/")).toThrow(/name/i);
    expect(() => proxyTarget("api 0", 80, "/")).toThrow(/name/i);
  });

  it("rejects a path that tries to climb out of the proxy subresource", () => {
    expect(() => proxyTarget("api-0", 80, "/../../../api/v1/secrets")).toThrow(/path/i);
    expect(() => proxyTarget("api-0", 80, "/a/../../b")).toThrow(/path/i);
  });

  it("rejects an absolute URL as the path", () => {
    expect(() => proxyTarget("api-0", 80, "http://evil.example/")).toThrow(/path/i);
    expect(() => proxyTarget("api-0", 80, "//evil.example/")).toThrow(/path/i);
  });
});
