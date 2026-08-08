/**
 * SQL Server driver — lightweight probe.
 *
 * Unlike the Postgres driver, SQL Server has no cached globalThis pool here —
 * `withPool` (in ./internal) opens a fresh `mssql.ConnectionPool` per call and
 * closes it in a `finally`, since mssql's own `sql.connect()` global pool is
 * shared process-wide and unsafe for concurrent requests. There is therefore
 * no pool-cache / dropPools / test-seam equivalent to move here.
 */
import type { SqlServerConfig } from "../types";
import { withPool } from "./internal";

export interface SqlServerProbeResult {
  version: string;
  databaseCount: number;
}

export async function probeSqlServer(
  config: SqlServerConfig
): Promise<SqlServerProbeResult> {
  return withPool(config, async (pool) => {
    const versionResult = await pool
      .request()
      .query<{ version: string }>("SELECT @@VERSION AS version");
    const version = versionResult.recordset[0]?.version ?? "unknown";
    const dbResult = await pool
      .request()
      .query<{ count: number }>("SELECT COUNT(*) AS count FROM sys.databases");
    return {
      version: String(version).split("\n")[0]?.trim() || "unknown",
      databaseCount: Number(dbResult.recordset[0]?.count ?? 0),
    };
  });
}
