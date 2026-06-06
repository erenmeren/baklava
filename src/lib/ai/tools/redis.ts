import { z } from "zod";
import type { RedisConfig } from "@/lib/connections/types";
import { info, listKeys, getKey, setStringValue, setTtl, delKey } from "@/lib/connections/redis";
import type { AiTool } from "./types";

export function redisTools(connectionId: string, config: RedisConfig): AiTool[] {
  const dbArg = z.number().int().min(0).optional();
  return [
    {
      name: "redis_info",
      description: "Server INFO (optionally a single section, e.g. 'memory').",
      category: "read",
      inputSchema: z.object({ section: z.string().optional() }),
      execute: async ({ section }) => info(connectionId, config, section as string | undefined),
    },
    {
      name: "redis_list_keys",
      description: "Scan keys matching a glob pattern (default '*'), with type/ttl/size.",
      category: "read",
      inputSchema: z.object({ pattern: z.string().optional(), db: dbArg }),
      execute: async ({ pattern, db }) =>
        listKeys(connectionId, config, { pattern: pattern as string | undefined, db: db as number | undefined }),
    },
    {
      name: "redis_get_key",
      description: "Read one key's typed value (string/hash/list/set/zset/stream/json).",
      category: "read",
      inputSchema: z.object({ key: z.string(), db: dbArg }),
      execute: async ({ key, db }) => getKey(connectionId, config, key as string, db as number | undefined),
    },
    {
      name: "redis_set_string",
      description: "Set a string key's value.",
      category: "write",
      inputSchema: z.object({ key: z.string(), value: z.string(), db: dbArg }),
      execute: async ({ key, value, db }) => {
        await setStringValue(connectionId, config, key as string, value as string, db as number | undefined);
        return { ok: true, key };
      },
    },
    {
      name: "redis_set_ttl",
      description: "Set a key's TTL in seconds (negative clears the expiry).",
      category: "write",
      inputSchema: z.object({ key: z.string(), ttlSeconds: z.number().int(), db: dbArg }),
      execute: async ({ key, ttlSeconds, db }) => {
        await setTtl(connectionId, config, key as string, ttlSeconds as number, db as number | undefined);
        return { ok: true, key };
      },
    },
    {
      name: "redis_delete_key",
      description: "Delete a key. DESTRUCTIVE.",
      category: "destructive",
      inputSchema: z.object({ key: z.string(), db: dbArg }),
      execute: async ({ key, db }) => {
        await delKey(connectionId, config, key as string, db as number | undefined);
        return { ok: true, deleted: key };
      },
    },
  ];
}
