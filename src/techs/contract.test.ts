import { describe, it, expect } from "vitest";
import { DriverNotInstalledError } from "./contract";

describe("DriverNotInstalledError", () => {
  it("carries tech id and package name and a clear message", () => {
    const err = new DriverNotInstalledError("postgres", "pg");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DriverNotInstalledError");
    expect(err.tech).toBe("postgres");
    expect(err.pkg).toBe("pg");
    expect(err.message).toContain("postgres");
    expect(err.message).toContain("pg");
  });
});
