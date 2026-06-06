import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/redis", () => ({
  info: vi.fn(async () => ({ server: {} })),
  listKeys: vi.fn(async () => ({ keys: [], scanned: 0, truncated: false })),
  getKey: vi.fn(async () => ({ key: "k", type: "string", ttl: -1, size: 1, value: { kind: "string", value: "v" } })),
  setStringValue: vi.fn(async () => undefined),
  setTtl: vi.fn(async () => undefined),
  delKey: vi.fn(async () => undefined),
}));

import * as r from "@/lib/connections/redis";
import { redisTools } from "./redis";

const cfg = { mode: "single" as const, host: "h", port: 6379, tls: false };
const tools = () => redisTools("c1", cfg as never);

describe("redisTools", () => {
  beforeEach(() => vi.clearAllMocks());
  it("tags categories and exposes no raw command", () => {
    const names = tools().map((t) => t.name);
    const cat = Object.fromEntries(tools().map((t) => [t.name, t.category]));
    expect(cat["redis_get_key"]).toBe("read");
    expect(cat["redis_set_string"]).toBe("write");
    expect(cat["redis_delete_key"]).toBe("destructive");
    expect(names).not.toContain("redis_run_command");
  });
  it("redis_get_key delegates", async () => {
    const t = tools().find((x) => x.name === "redis_get_key")!;
    await t.execute({ key: "k", db: 0 });
    expect(r.getKey).toHaveBeenCalledWith("c1", cfg, "k", 0);
  });
  it("redis_delete_key delegates", async () => {
    const t = tools().find((x) => x.name === "redis_delete_key")!;
    await t.execute({ key: "k" });
    expect(r.delKey).toHaveBeenCalledWith("c1", cfg, "k", undefined);
  });
});
