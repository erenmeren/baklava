import { describe, it, expect } from "vitest";
import { docker } from "./index";

describe("docker module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(docker.id).toBe("docker");
    expect(docker.optionalDeps).toEqual(["dockerode", "ssh2"]);
    expect(docker.catalog.id).toBe("docker");
    expect(docker.serverPackages).toEqual(["dockerode", "ssh2"]);
  });
  it("summarises a connection record", () => {
    const summary = docker.summary({
      id: "x", tech: "docker", name: "n", status: "ok", createdAt: 0,
      config: { mode: "tcp", protocol: "http", host: "h", port: 2375 },
    });
    expect(summary).toBe("http://h:2375");
  });
  it("exposes secret keys and a probe", () => {
    expect(docker.config.secretKeys).toEqual([]);
    expect(typeof docker.driver.probe).toBe("function");
  });
});
