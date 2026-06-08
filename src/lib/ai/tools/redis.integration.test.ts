/**
 * Dogfood: drives the actual AI `redis_*` tools against a real Redis.
 * Gated by BAKLAVA_INTEGRATION=1; self-skips if Redis isn't on localhost:6379.
 *
 *   docker run -d --name redis -p 6379:6379 redis:7-alpine
 *   BAKLAVA_INTEGRATION=1 npx vitest run src/lib/ai/tools/redis.integration.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { reachable } from "@/test/integration-helpers";
import { redisTools } from "./redis";
import type { AiTool } from "./types";

const cfg = {
  mode: "single" as const,
  host: process.env.BAKLAVA_REDIS_HOST ?? "localhost",
  port: 6379,
  tls: false,
};
const tools = redisTools("dogfood-conn", cfg as never);
const tool = (name: string): AiTool => tools.find((t) => t.name === name)!;

const KEY = "dogfood:greeting";

describe("redis tools against real Redis", async () => {
  const up = await reachable("localhost", 6379);
  beforeAll(() => {
    if (!up) console.warn("[skip] redis not reachable on localhost:6379");
  });

  it.skipIf(!up)("typed set → get → ttl → list → delete round-trip", async () => {
    await tool("redis_set_string").execute({ key: KEY, value: "hello", db: 0 });

    const got = await tool("redis_get_key").execute({ key: KEY, db: 0 });
    expect(JSON.stringify(got)).toContain("hello");

    await tool("redis_set_ttl").execute({ key: KEY, ttlSeconds: 120, db: 0 });

    const keys = await tool("redis_list_keys").execute({ pattern: "dogfood:*", db: 0 });
    expect(JSON.stringify(keys)).toContain(KEY);

    await tool("redis_delete_key").execute({ key: KEY, db: 0 });
    const afterDelete = await tool("redis_get_key").execute({ key: KEY, db: 0 });
    expect(JSON.stringify(afterDelete)).not.toContain("hello");
  }, 20000);

  it.skipIf(!up)("info returns server data and there is no raw-command tool", async () => {
    const info = await tool("redis_info").execute({ section: "server" });
    expect(JSON.stringify(info).length).toBeGreaterThan(2);
    // Typed surface only — no arbitrary command execution is exposed.
    expect(tools.some((t) => /run_command|raw|eval|exec/i.test(t.name))).toBe(false);
  });
});
