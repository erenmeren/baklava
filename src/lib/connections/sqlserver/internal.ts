/**
 * SQL Server driver — cross-module private helpers.
 *
 * Exported from here so multiple sibling modules can share them, but NOT
 * re-exported from the barrel (sqlserver.ts) — these were never part of the
 * driver's public surface and must stay invisible outside ./sqlserver/*.
 */
import type { ConnectionPool } from "mssql"; // type-only — erased at build, safe when mssql absent
import { DriverNotInstalledError } from "@/techs/contract";
import type { SqlServerConfig } from "../types";
import type { SqlServerDatabaseSummary } from "./catalog";

let _mssqlMod: typeof import("mssql") | null = null;
export async function getMssql(): Promise<typeof import("mssql")> {
  try {
    return (_mssqlMod ??= await import("mssql"));
  } catch {
    throw new DriverNotInstalledError("sqlserver", "mssql");
  }
}

export async function withPool<T>(
  config: SqlServerConfig,
  fn: (pool: ConnectionPool) => Promise<T>,
  opts?: { database?: string; requestTimeoutMs?: number }
): Promise<T> {
  // IMPORTANT: do NOT use `sql.connect(cfg)` — that returns mssql's
  // *global* pool, which is shared across every concurrent request in the
  // Next.js process. Two overlapping requests would clobber each other's
  // active database, and one finishing first would close the global pool
  // out from under the other (ECONNCLOSED). Construct a fresh pool per
  // call instead so each request is fully isolated.
  const { ConnectionPool: MssqlPool } = await getMssql();
  const pool = new MssqlPool({
    server: config.host,
    port: config.port,
    database: opts?.database || config.database || undefined,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
    connectionTimeout: 8000,
    requestTimeout: opts?.requestTimeoutMs ?? 15000,
  });
  await pool.connect();
  try {
    return await fn(pool);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

const SQLSERVER_SYSTEM_DBS = new Set(["master", "tempdb", "model", "msdb"]);

export async function fetchDatabaseStats(
  pool: ConnectionPool
): Promise<SqlServerDatabaseSummary[]> {
  // sys.databases is the canonical catalog view; the older master.dbo.sysdatabases
  // is deprecated. sys.master_files exposes per-file sizes in 8KB pages.
  const result = await pool.request().query<{
    name: string;
    state_desc: string;
    size_bytes: string | number | null;
  }>(`
    SELECT
      d.name AS name,
      d.state_desc AS state_desc,
      (
        SELECT SUM(CAST(size AS BIGINT) * 8192)
        FROM sys.master_files mf
        WHERE mf.database_id = d.database_id
      ) AS size_bytes
    FROM sys.databases d
    ORDER BY d.name
  `);

  const rows = result.recordset;
  const summaries: SqlServerDatabaseSummary[] = [];

  for (const row of rows) {
    let tableCount = 0;
    // Per-database table count requires querying sys.tables in that DB.
    // sys.tables is per-database, but we can use three-part naming since
    // sys.tables exists in every database with the same schema.
    try {
      const dbName = String(row.name).replace(/]/g, "]]");
      const countResult = await pool.request().query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM [${dbName}].sys.tables WHERE type = 'U'`
      );
      tableCount = Number(countResult.recordset[0]?.count ?? 0);
    } catch {
      // Database may be offline / restoring / no permissions — leave 0.
    }

    summaries.push({
      name: String(row.name),
      state: String(row.state_desc ?? "UNKNOWN"),
      sizeBytes: Number(row.size_bytes ?? 0),
      tableCount,
      isSystem: SQLSERVER_SYSTEM_DBS.has(String(row.name).toLowerCase()),
    });
  }

  // Return alphabetically by name (the query already ORDER BY d.name).
  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}
