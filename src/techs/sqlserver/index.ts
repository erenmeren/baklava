// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { SqlServerConfig } from "@/lib/connections/types";
import { probeSqlServer } from "@/lib/connections/sqlserver";
import { sqlserverMeta } from "./meta";

export const sqlserver: TechModule<SqlServerConfig> = {
  ...sqlserverMeta,
  driver: { probe: (c) => probeSqlServer(c) },
};
