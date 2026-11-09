import { describe, it, expect } from "vitest";
import { createDockerClient, dockerErrorStatus, inspectContainer, removeImage } from "./docker";
import type { DockerConfig } from "./types";

// Unroutable TCP target: a valid id builds a request object without dialing,
// an invalid one must throw before anything reaches dockerode's path builder.
const cfg = { mode: "tcp", host: "127.0.0.1", port: 1 } as DockerConfig;

describe("docker id validation", () => {
  it.each([
    "../swarm?",
    "x/archive?path=/etc/shadow&",
    "a/../b",
    "abc#x",
    "abc%2F",
    " abc",
    "",
    "/abc",
    ".hidden",
  ])("rejects container/network/volume id %j", async (bad) => {
    const client = await createDockerClient(cfg);
    expect(() => client.getContainer(bad)).toThrow(/Invalid/);
    expect(() => client.getNetwork(bad)).toThrow(/Invalid/);
    expect(() => client.getVolume(bad)).toThrow(/Invalid/);
    expect(() => client.getExec(bad)).toThrow(/Invalid/);
    await expect(inspectContainer(cfg, bad)).rejects.toSatisfy(
      (e: unknown) => dockerErrorStatus(e) === 400,
    );
  });

  it.each(["4f2a9c", "my_app-1.web", "baklava_vol"])("accepts name/id %j", async (ok) => {
    const client = await createDockerClient(cfg);
    expect(() => client.getContainer(ok)).not.toThrow();
    expect(() => client.getVolume(ok)).not.toThrow();
  });

  it.each([
    "nginx",
    "nginx:1.27-alpine",
    "library/nginx:latest",
    "localhost:5000/team/app:v1",
    "ghcr.io/org/app@sha256:" + "a".repeat(64),
    "sha256:" + "b".repeat(64),
  ])("accepts image ref %j", async (ok) => {
    const client = await createDockerClient(cfg);
    expect(() => client.getImage(ok)).not.toThrow();
  });

  it.each(["../swarm", "nginx/../../swarm", "nginx?x", "nginx#x", "ng%2Fx", "/nginx", "a b", "a//b"])(
    "rejects image ref %j",
    async (bad) => {
      const client = await createDockerClient(cfg);
      expect(() => client.getImage(bad)).toThrow(/Invalid/);
      await expect(removeImage(cfg, bad)).rejects.toThrow(/Invalid/);
    },
  );

  it("maps other errors to 502", () => {
    expect(dockerErrorStatus(new Error("connect ECONNREFUSED"))).toBe(502);
  });
});
