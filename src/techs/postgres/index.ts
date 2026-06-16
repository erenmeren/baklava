import { z } from "zod";
import type { BaseConfig, TechModule } from "@/techs/contract";
import type { PostgresConfig, ConnectionRecord } from "@/lib/connections/types";
import { probePostgres } from "@/lib/connections/postgres";
import { OBJECT_PROVIDERS } from "@/lib/command-palette/object-providers";

/** Intersection so PgConfig satisfies BaseConfig's index signature constraint
 *  while retaining all typed fields from PostgresConfig. */
type PgConfig = PostgresConfig & BaseConfig;

const schema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  ssl: z.boolean(),
});

export const postgres: TechModule<PgConfig> = {
  id: "postgres",
  catalog: {
    id: "postgres",
    name: "PostgreSQL",
    tagline: "Relational database",
    description: "Run queries, browse schemas and inspect tables.",
    category: "Database",
    color: "from-indigo-400 to-violet-600",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<PgConfig>, secretKeys: ["password"] },
  driver: { probe: (c) => probePostgres(c) },
  summary: (r: ConnectionRecord) => {
    const c = r.config as PostgresConfig;
    return `${c.user}@${c.host}:${c.port}/${c.database}`;
  },
  firstPage: "",
  optionalDeps: ["pg"],
  serverPackages: ["pg"],
  commandObjects: OBJECT_PROVIDERS.postgres,
  capabilities: { browse: true, query: true, objectExplorer: true, health: true },
};
