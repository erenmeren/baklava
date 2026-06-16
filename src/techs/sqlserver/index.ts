import { z } from "zod";
import type { TechModule } from "@/techs/contract";
import type { SqlServerConfig, ConnectionRecord } from "@/lib/connections/types";
import { probeSqlServer } from "@/lib/connections/sqlserver";
import { OBJECT_PROVIDERS } from "@/lib/command-palette/object-providers";

const schema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  encrypt: z.boolean(),
  trustServerCertificate: z.boolean(),
});

export const sqlserver: TechModule<SqlServerConfig> = {
  id: "sqlserver",
  catalog: {
    id: "sqlserver",
    name: "SQL Server",
    tagline: "Microsoft relational database",
    description: "Databases, tables, queries.",
    category: "Database",
    color: "from-red-400 to-rose-600",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<SqlServerConfig>, secretKeys: ["password"] },
  driver: { probe: (c) => probeSqlServer(c) },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as SqlServerConfig;
    return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  },
  firstPage: "",
  optionalDeps: ["mssql", "tedious"],
  serverPackages: ["mssql", "tedious"],
  commandObjects: OBJECT_PROVIDERS.sqlserver,
  capabilities: { browse: true, query: true, objectExplorer: true, health: true },
};
