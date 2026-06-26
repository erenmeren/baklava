import { describe, it, expect } from "vitest";
import { normalizeBaseUrl, rewriteLocalhostForDocker } from "./url";

describe("normalizeBaseUrl", () => {
  it("prepends http:// when no scheme is present", () => {
    expect(normalizeBaseUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBaseUrl("api.example.com")).toBe("http://api.example.com");
  });

  it("leaves an existing scheme untouched", () => {
    expect(normalizeBaseUrl("https://api.example.com")).toBe("https://api.example.com");
    expect(normalizeBaseUrl("http://localhost:200")).toBe("http://localhost:200");
  });
});

describe("rewriteLocalhostForDocker", () => {
  it("handles a scheme-less localhost target (the reported bug)", () => {
    // Previously `new URL("localhost:200")` read "localhost:" as the protocol,
    // so the rewrite missed it and k6 got an unsupported scheme.
    const r = rewriteLocalhostForDocker("localhost:200");
    expect(r.rewritten).toBe(true);
    expect(r.url).toBe("http://host.docker.internal:200/");
  });

  it("rewrites localhost to host.docker.internal", () => {
    expect(rewriteLocalhostForDocker("http://localhost:3000")).toEqual({
      url: "http://host.docker.internal:3000/",
      rewritten: true,
    });
  });

  it("rewrites 127.0.0.1", () => {
    const r = rewriteLocalhostForDocker("http://127.0.0.1:8080/api");
    expect(r.rewritten).toBe(true);
    expect(r.url).toBe("http://host.docker.internal:8080/api");
  });

  it("leaves remote hosts untouched", () => {
    expect(rewriteLocalhostForDocker("https://api.example.com")).toEqual({
      url: "https://api.example.com",
      rewritten: false,
    });
  });
});
