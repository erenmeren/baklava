import type { Connection, RowDataPacket, ConnectionOptions } from "mysql2/promise"; // type-only — erased at build, safe when mysql2 absent
import type { MysqlConfig } from "./types";
import { DriverNotInstalledError } from "@/techs/contract";

/**
 * Connection plumbing shared by `mysql.ts` and its sibling feature modules
 * (`mysql-constraints.ts`).
 *
 * This mirrors the `<tech>/internal.ts` convention Phase 1 established for
 * the split Postgres and SQL Server drivers: cross-module private helpers
 * that don't belong to the public driver surface live here, and nothing
 * re-exports them. `mysql.ts` imports them back, so its own exported surface
 * is unchanged by the move.
 */

let _mysql2Mod: typeof import("mysql2/promise") | null = null;

export async function getMysql2(): Promise<typeof import("mysql2/promise")> {
  try {
    return (_mysql2Mod ??= await import("mysql2/promise"));
  } catch {
    throw new DriverNotInstalledError("mysql", "mysql2");
  }
}

function buildConnConfig(
  config: MysqlConfig,
  databaseOverride?: string,
  opts?: { multipleStatements?: boolean }
): ConnectionOptions {
  const database = databaseOverride ?? config.database;
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: database || undefined,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 6000,
    multipleStatements: opts?.multipleStatements ?? false,
    // Keep large integers as strings so BIGINT / counts don't lose precision,
    // and decimals stay exact. The UI renders everything as text anyway.
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    dateStrings: true,
  };
}

/**
 * Opens a fresh connection per call. The intended-but-deferred architecture is
 * a cached pool per connection record; don't refactor it in-flight (see
 * AGENTS.md "Known design gap").
 */
export async function withConn<T>(
  config: MysqlConfig,
  database: string | undefined,
  fn: (conn: Connection) => Promise<T>,
  opts?: { multipleStatements?: boolean }
): Promise<T> {
  const { createConnection } = await getMysql2();
  const conn = await createConnection(
    buildConnConfig(config, database, opts)
  );
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export async function query<T extends RowDataPacket = RowDataPacket>(
  conn: Connection,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const [rows] = await conn.query<T[]>(sql, params);
  return rows;
}
