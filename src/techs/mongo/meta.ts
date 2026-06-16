import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import type { MongoConfig, ConnectionRecord } from "@/lib/connections/types";

const schema = z.object({
  uri: z.string(),
  defaultDb: z.string().optional(),
});

export const mongoMeta: TechModuleMeta<MongoConfig> = {
  id: "mongo",
  catalog: {
    id: "mongo",
    name: "MongoDB",
    tagline: "Document database",
    description:
      "Compass-style: databases, collections, document browser with EJSON filter, aggregation pipeline, indexes.",
    category: "Database",
    color: "from-emerald-400 to-green-700",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<MongoConfig>, secretKeys: ["uri"] },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as MongoConfig;
    const uri = cfg.uri ?? "";
    const stripped = uri.replace(/(mongodb(?:\+srv)?:\/\/)[^@/]*@/, "$1");
    const db = cfg.defaultDb ? ` · ${cfg.defaultDb}` : "";
    return `${stripped}${db}`;
  },
  firstPage: "databases",
  optionalDeps: ["mongodb", "bson"],
  serverPackages: ["mongodb"],
  capabilities: { browse: true, query: true, objectExplorer: true, health: true },
};
