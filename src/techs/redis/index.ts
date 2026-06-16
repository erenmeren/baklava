// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { RedisConfig } from "@/lib/connections/types";
import { probe as probeRedis, dropRedisClient } from "@/lib/connections/redis";
import { redisBody } from "@/lib/connections/health";
import { redisMeta } from "./meta";

export const redis: TechModule<RedisConfig> = {
  ...redisMeta,
  driver: {
    probe: async (c: RedisConfig) => {
      const id = `__probe_${Math.random().toString(36).slice(2)}`;
      try {
        return await probeRedis(id, c);
      } finally {
        dropRedisClient(id);
      }
    },
    health: redisBody,
  },
};
