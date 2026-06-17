import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import type { RedisConfig, ConnectionRecord } from "@/lib/connections/types";

const schema = z.object({
  mode: z.enum(["single", "cluster"]),
  host: z.string().optional(),
  port: z.number().optional(),
  nodes: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  db: z.number().optional(),
  tls: z.boolean(),
});

export const redisMeta: TechModuleMeta<RedisConfig> = {
  id: "redis",
  catalog: {
    id: "redis",
    name: "Redis",
    tagline: "In-memory data store",
    description:
      "RedisInsight-style browser: typed key viewer, CLI, pub/sub, streams, MONITOR, cluster topology.",
    category: "Cache",
    color: "from-rose-400 to-red-700",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<RedisConfig>, secretKeys: ["password"] },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as RedisConfig;
    const proto = cfg.tls ? "rediss" : "redis";
    if (cfg.mode === "cluster") {
      return `${proto}-cluster · ${(cfg.nodes ?? "").split(",").length} seed nodes`;
    }
    const auth = cfg.username ? `${cfg.username}@` : "";
    const db = typeof cfg.db === "number" && cfg.db > 0 ? `/${cfg.db}` : "";
    return `${proto}://${auth}${cfg.host ?? ""}:${cfg.port ?? 6379}${db}`;
  },
  firstPage: "keys",
  optionalDeps: ["ioredis"],
  serverPackages: ["ioredis"],
  capabilities: { browse: true, query: true, health: true },
};
