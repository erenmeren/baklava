import { describe, it, expect, afterEach } from "vitest";
import { resolveInstallPackages, isInstallAllowed } from "./install";

describe("resolveInstallPackages", () => {
  it("returns the tech's declared optionalDeps", () => {
    expect(resolveInstallPackages("postgres")).toEqual(["pg", "pg-cursor"]);
    expect(resolveInstallPackages("mongo")).toEqual(["mongodb", "bson"]);
  });
  it("throws for an unknown tech (never trusts client input)", () => {
    expect(() => resolveInstallPackages("rm -rf")).toThrow();
    expect(() => resolveInstallPackages("loadtest")).toThrow();
  });
});

describe("isInstallAllowed", () => {
  afterEach(() => { delete process.env.BAKLAVA_DISABLE_DRIVER_INSTALL; });
  it("allows local hosts", () => {
    expect(isInstallAllowed("localhost:3000")).toBe(true);
    expect(isInstallAllowed("127.0.0.1:3000")).toBe(true);
    expect(isInstallAllowed("[::1]:3000")).toBe(true);
    expect(isInstallAllowed("app.localhost:3000")).toBe(true);
    expect(isInstallAllowed("LOCALHOST:3000")).toBe(true);
    expect(isInstallAllowed("[::1]")).toBe(true);
  });
  it("denies non-local hosts", () => {
    expect(isInstallAllowed("baklava.example.com")).toBe(false);
    expect(isInstallAllowed("10.0.0.5:3000")).toBe(false);
    expect(isInstallAllowed(null)).toBe(false);
    expect(isInstallAllowed("localhost.evil.com")).toBe(false);
    expect(isInstallAllowed("x.localhost.evil.com")).toBe(false);
    expect(isInstallAllowed("notlocalhost")).toBe(false);
    expect(isInstallAllowed("")).toBe(false);
  });
  it("denies everything when disabled by env", () => {
    process.env.BAKLAVA_DISABLE_DRIVER_INSTALL = "1";
    expect(isInstallAllowed("localhost:3000")).toBe(false);
  });
  it("treats empty-string env as not-disabled", () => {
    process.env.BAKLAVA_DISABLE_DRIVER_INSTALL = "";
    expect(isInstallAllowed("localhost:3000")).toBe(true);
  });
});
