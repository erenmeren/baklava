import { describe, it, expect, afterEach } from "vitest";
import { classifyIp, assertHostAllowed, EgressBlockedError } from "./egress";

afterEach(() => {
  delete process.env.BAKLAVA_EGRESS_ALLOW;
});

describe("classifyIp", () => {
  it("classifies v4", () => {
    expect(classifyIp("169.254.169.254")).toBe("metadata");
    expect(classifyIp("169.254.1.1")).toBe("link-local");
    expect(classifyIp("127.0.0.1")).toBe("loopback");
    expect(classifyIp("10.1.2.3")).toBe("private");
    expect(classifyIp("172.16.0.1")).toBe("private");
    expect(classifyIp("192.168.1.5")).toBe("private");
    expect(classifyIp("8.8.8.8")).toBe("public");
  });
  it("classifies v6", () => {
    expect(classifyIp("::1")).toBe("loopback");
    expect(classifyIp("fe80::1")).toBe("link-local");
    expect(classifyIp("fd00:ec2::254")).toBe("metadata");
    expect(classifyIp("fd12::1")).toBe("private");
    expect(classifyIp("2606:4700::1")).toBe("public");
  });
  it("classifies IPv4-mapped IPv6 in all spellings (SSRF bypass guard)", () => {
    expect(classifyIp("::ffff:169.254.169.254")).toBe("metadata");
    expect(classifyIp("::ffff:a9fe:a9fe")).toBe("metadata");
    expect(classifyIp("0:0:0:0:0:ffff:169.254.169.254")).toBe("metadata");
    expect(classifyIp("::ffff:127.0.0.1")).toBe("loopback");
    expect(classifyIp("::ffff:10.0.0.1")).toBe("private");
    expect(classifyIp("::ffff:8.8.8.8")).toBe("public");
  });
});

describe("assertHostAllowed", () => {
  const lookup = (map: Record<string, string[]>) => (h: string) => Promise.resolve(map[h] ?? []);

  it("blocks metadata regardless of host", async () => {
    await expect(
      assertHostAllowed("metadata.evil.com", { lookup: lookup({ "metadata.evil.com": ["169.254.169.254"] }) }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("blocks link-local", async () => {
    await expect(assertHostAllowed("169.254.1.1")).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("allows private + loopback by default (homelab)", async () => {
    expect(await assertHostAllowed("10.0.0.5")).toEqual(["10.0.0.5"]);
    expect(await assertHostAllowed("127.0.0.1")).toEqual(["127.0.0.1"]);
  });

  it("blocks private when allowPrivate is false", async () => {
    await expect(assertHostAllowed("10.0.0.5", { allowPrivate: false })).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("allows a public host and returns resolved IPs", async () => {
    expect(await assertHostAllowed("api.example.com", { lookup: lookup({ "api.example.com": ["93.184.216.34"] }) }))
      .toEqual(["93.184.216.34"]);
  });

  it("BAKLAVA_EGRESS_ALLOW re-allows a blocked IP", async () => {
    process.env.BAKLAVA_EGRESS_ALLOW = "169.254.169.254";
    expect(await assertHostAllowed("169.254.169.254")).toEqual(["169.254.169.254"]);
  });

  it("throws when a host does not resolve", async () => {
    await expect(assertHostAllowed("nope.invalid", { lookup: lookup({}) })).rejects.toBeInstanceOf(EgressBlockedError);
  });
});
