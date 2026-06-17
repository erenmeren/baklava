// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { MysqlConfig } from "@/lib/connections/types";
import { probeMysql } from "@/lib/connections/mysql";
import { mysqlBody } from "@/lib/connections/health";
import { mysqlMeta } from "./meta";

export const mysql: TechModule<MysqlConfig> = {
  ...mysqlMeta,
  driver: { probe: (c) => probeMysql(c), health: mysqlBody },
};
