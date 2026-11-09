import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RedisConfig } from "./types";

// Fake ioredis: records each client's constructor options and every command.
interface Fake {
  opts: { db?: number };
  calls: string[];
  disconnected: boolean;
}
const clients: Fake[] = [];
let aclList: string[] = [];

vi.mock("ioredis", () => {
  class FakeRedis {
    f: Fake;
    status = "ready";
    constructor(opts: { db?: number }) {
      this.f = { opts, calls: [], disconnected: false };
      clients.push(this.f);
    }
    on() {}
    async connect() {}
    disconnect() {
      this.f.disconnected = true;
    }
    async select(db: number) {
      this.f.calls.push(`SELECT ${db}`);
    }
    async type() {
      this.f.calls.push("TYPE");
      return "none";
    }
    async ttl() {
      return -2;
    }
    async del() {
      this.f.calls.push("DEL");
    }
    async set(...args: string[]) {
      this.f.calls.push(["SET", ...args.slice(2)].join(" ").trim());
      return "OK";
    }
    async call(...args: string[]) {
      this.f.calls.push(args.join(" "));
      if (args[0] === "ACL" && args[1] === "LIST") return aclList;
      if (args[0] === "ACL" && args[1] === "WHOAMI") return "default";
      return 0;
    }
  }
  return { default: FakeRedis, Cluster: class {} };
});

const cfg: RedisConfig = { mode: "single", host: "127.0.0.1", port: 6379, tls: false };

describe("redis client per database", () => {
  let redis: typeof import("./redis");
  beforeEach(async () => {
    clients.length = 0;
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.redisClients")];
    vi.resetModules();
    redis = await import("./redis");
  });

  it("never issues SELECT on a shared client; each db gets its own client", async () => {
    await redis.getKey("c1", cfg, "k", 3);
    await redis.delKey("c1", cfg, "k");
    await redis.setStringValue("c1", cfg, "k", "v", 3);
    expect(clients.flatMap((c) => c.calls).some((c) => c.startsWith("SELECT"))).toBe(false);
    expect(clients.map((c) => c.opts.db).sort()).toEqual([0, 3]);
    const db3 = clients.find((c) => c.opts.db === 3)!;
    expect(db3.calls).toContain("SET");
    expect(clients.find((c) => c.opts.db === 0)!.calls).toContain("DEL");
  });

  it("setStringValue with nx sends SET … NX", async () => {
    await redis.setStringValue("c1", cfg, "k", "v", 3, { nx: true });
    expect(clients.find((c) => c.opts.db === 3)!.calls).toContain("SET NX");
  });

  it("omitted db uses the connection's configured db, not whatever ran last", async () => {
    await redis.getKey("c1", { ...cfg, db: 2 }, "k", 5);
    await redis.delKey("c1", { ...cfg, db: 2 }, "k");
    expect(clients.find((c) => c.calls.includes("DEL"))!.opts.db).toBe(2);
  });

  it("dropRedisClient tears down every per-db client of the connection only", async () => {
    await redis.getKey("c1", cfg, "k", 0);
    await redis.getKey("c1", cfg, "k", 4);
    await redis.getKey("c2", cfg, "k", 4);
    redis.dropRedisClient("c1");
    expect(clients.filter((c) => c.disconnected)).toHaveLength(2);
    expect(clients[2].disconnected).toBe(false);
  });

  it("refuses SELECT at the CLI (it would re-point the shared client)", async () => {
    await expect(redis.runCommand("c1", cfg, ["select", "1"])).rejects.toThrow(/SELECT/);
  });
});

describe("getAcl", () => {
  it("strips password hashes and plaintext passwords from ACL LIST", async () => {
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.redisClients")];
    const redis = await import("./redis");
    aclList = [
      "user default on nopass ~* &* +@all",
      `user app on #${"a".repeat(64)} >s3cret ~app:* +get`,
    ];
    const out = await redis.getAcl("c9", cfg);
    expect(out.list[0]).toBe("user default on nopass ~* &* +@all");
    expect(out.list[1]).toBe("user app on #<redacted> ><redacted> ~app:* +get");
    expect(out.list.join(" ")).not.toMatch(/aaaa|s3cret/);
  });
});
