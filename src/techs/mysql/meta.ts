import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import type { MysqlConfig, ConnectionRecord } from "@/lib/connections/types";
import { OBJECT_PROVIDERS } from "@/lib/command-palette/object-providers";

const schema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  ssl: z.boolean(),
});

export const mysqlMeta: TechModuleMeta<MysqlConfig> = {
  id: "mysql",
  catalog: {
    id: "mysql",
    name: "MySQL",
    tagline: "Relational database",
    description:
      "phpMyAdmin-style: databases, tables, query editor, row CRUD, indexes and live process list.",
    category: "Database",
    color: "from-amber-400 to-orange-600",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<MysqlConfig>, secretKeys: ["password"] },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as MysqlConfig;
    const db = cfg.database ? `/${cfg.database}` : "";
    return `${cfg.user}@${cfg.host}:${cfg.port}${db}`;
  },
  firstPage: "",
  optionalDeps: ["mysql2"],
  serverPackages: ["mysql2"],
  commandObjects: OBJECT_PROVIDERS.mysql,
  capabilities: { browse: true, query: true, objectExplorer: true, health: true },
};
