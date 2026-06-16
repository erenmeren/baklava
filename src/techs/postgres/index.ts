// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { PostgresConfig } from "@/lib/connections/types";
import { probePostgres } from "@/lib/connections/postgres";
import { postgresMeta } from "./meta";

export const postgres: TechModule<PostgresConfig> = {
  ...postgresMeta,
  driver: { probe: (c) => probePostgres(c) },
};
