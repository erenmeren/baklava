import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import type { SqlServerConfig, ConnectionRecord } from "@/lib/connections/types";
import { sqlserverProvider } from "@/lib/command-palette/sql-providers";

const schema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  encrypt: z.boolean(),
  trustServerCertificate: z.boolean(),
});

export const sqlserverMeta: TechModuleMeta<SqlServerConfig> = {
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
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as SqlServerConfig;
    return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  },
  firstPage: "",
  optionalDeps: ["mssql", "tedious"],
  serverPackages: ["mssql", "tedious"],
  commandObjects: sqlserverProvider,
  capabilities: { browse: true, query: true, objectExplorer: true, health: true },
};
