import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/docker", () => ({
  listContainers: vi.fn(async () => [{ id: "abc", name: "api", state: "running" }]),
  inspectContainer: vi.fn(async () => ({ State: { Status: "running" } })),
  readContainerLogs: vi.fn(async () => "boom\nstack trace"),
  containerAction: vi.fn(async () => undefined),
}));

import * as docker from "@/lib/connections/docker";
import { dockerTools } from "./docker";

const cfg = { mode: "socket" as const, socketPath: "/var/run/docker.sock" };

describe("dockerTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags categories correctly", () => {
    const byName = Object.fromEntries(dockerTools("c1", cfg).map((t) => [t.name, t.category]));
    expect(byName["docker_list_containers"]).toBe("read");
    expect(byName["docker_read_logs"]).toBe("read");
    expect(byName["docker_action"]).toBe("write");
    expect(byName["docker_remove"]).toBe("destructive");
  });

  it("docker_action delegates with the chosen action", async () => {
    const tool = dockerTools("c1", cfg).find((t) => t.name === "docker_action")!;
    await tool.execute({ containerId: "abc", action: "restart" });
    expect(docker.containerAction).toHaveBeenCalledWith(cfg, "abc", "restart");
  });

  it("docker_remove maps to containerAction remove", async () => {
    const tool = dockerTools("c1", cfg).find((t) => t.name === "docker_remove")!;
    await tool.execute({ containerId: "abc" });
    expect(docker.containerAction).toHaveBeenCalledWith(cfg, "abc", "remove");
  });
});
