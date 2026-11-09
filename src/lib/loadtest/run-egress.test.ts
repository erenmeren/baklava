import { describe, it, expect, afterEach, vi } from "vitest";
import { runLoadTest } from "./run-load-test";

const cfg = {
  name: "ssrf",
  target: { baseUrl: "http://169.254.169.254/latest/meta-data" },
  requests: [{ name: "r", method: "GET", path: "/" }],
  auth: { type: "none" },
  profile: { type: "constant", vus: 1, duration: "1s" },
  thresholds: undefined,
};

describe("loadtest egress", () => {
  it("refuses a metadata-IP target before running k6", async () => {
    await expect(runLoadTest(cfg)).rejects.toThrow(/blocked|metadata/i);
  });
});

describe("loadtest egress — what k6 is told", () => {
  const capture = () => {
    let script = "";
    const executor = {
      run: async (s: string) => {
        script = s;
        return { summary: {} } as never;
      },
    };
    return { executor, script: () => script };
  };
  const optionsOf = (script: string) =>
    JSON.parse(script.match(/export const options = (\{[\s\S]*?\n\});/)![1]) as Record<string, unknown>;

  afterEach(() => delete process.env.BAKLAVA_EGRESS_ALLOW);

  it("blacklists the metadata / link-local ranges for every connection k6 makes (redirects too)", async () => {
    const c = capture();
    await runLoadTest({ ...cfg, target: { baseUrl: "http://10.0.0.5:8080" } }, { executor: c.executor as never }).catch(() => {});
    const o = optionsOf(c.script());
    expect(o.blacklistIPs).toEqual(expect.arrayContaining(["169.254.0.0/16", "fd00:ec2::254/128"]));
    expect(o.maxRedirects).toBeUndefined();
    expect(o.hosts).toBeUndefined(); // an IP literal needs no pin
  });

  it("an allow-listed address inside a blocked range carves it out and stops redirects", async () => {
    process.env.BAKLAVA_EGRESS_ALLOW = "169.254.10.10";
    const c = capture();
    await runLoadTest({ ...cfg, target: { baseUrl: "http://169.254.10.10" } }, { executor: c.executor as never }).catch(() => {});
    const o = optionsOf(c.script());
    expect(o.blacklistIPs).not.toContain("169.254.0.0/16");
    expect(o.maxRedirects).toBe(0);
  });

  it("localhost is rewritten for the container and never pinned", async () => {
    const c = capture();
    await runLoadTest({ ...cfg, target: { baseUrl: "http://localhost:3000" } }, { executor: c.executor as never }).catch(() => {});
    expect(optionsOf(c.script()).hosts).toBeUndefined();
  });
});

describe("loadtest egress — internal targets refused when not allowed", () => {
  const executor = { run: vi.fn(async () => ({ summary: {} }) as never) };
  afterEach(() => executor.run.mockClear());

  it.each(["http://localhost:2375", "http://127.0.0.1:2375", "http://10.0.0.5", "http://[::1]:8080", "http://192.168.1.1"])(
    "refuses %s before running k6",
    async (baseUrl) => {
      await expect(
        runLoadTest({ ...cfg, target: { baseUrl } }, { executor: executor as never, allowInternalTargets: false }),
      ).rejects.toThrow(/blocked/i);
      expect(executor.run).not.toHaveBeenCalled();
    },
  );

  it("a public target still runs, without following redirects (a 30x could point inside)", async () => {
    let script = "";
    const ex = { run: async (s: string) => ((script = s), { summary: {} }) as never };
    await runLoadTest(
      { ...cfg, target: { baseUrl: "http://8.8.8.8" } },
      { executor: ex as never, allowInternalTargets: false },
    ).catch(() => {});
    const o = JSON.parse(script.match(/export const options = (\{[\s\S]*?\n\});/)![1]);
    expect(o.maxRedirects).toBe(0);
  });
});

