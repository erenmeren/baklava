import { describe, it, expect } from "vitest";
import { rewriteLocalhostForDocker } from "./url";

describe("rewriteLocalhostForDocker", () => {
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
