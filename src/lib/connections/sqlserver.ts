import sql, { ConnectionPool } from "mssql";
import type { SqlServerConfig } from "./types";

const SQLSERVER_SYSTEM_DBS = new Set(["master", "tempdb", "model", "msdb"]);

export interface SqlServerDatabaseSummary {
  name: string;
  sizeBytes: number;
  tableCount: number;
  isSystem: boolean;
  state: string;
}

export interface SqlServerOverview {
  version: string;
  productVersion: string | null;
  edition: string | null;
  serverName: string | null;
  currentUser: string | null;
  collation: string | null;
  startTime: string | null;
  databaseCount: number;
  topDatabases: SqlServerDatabaseSummary[];
}

export interface SqlServerProbeResult {
  version: string;
  databaseCount: number;
}

async function withPool<T>(
  config: SqlServerConfig,
  fn: (pool: ConnectionPool) => Promise<T>
): Promise<T> {
  const pool = await sql.connect({
    server: config.host,
    port: config.port,
    database: config.database || undefined,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
    connectionTimeout: 8000,
    requestTimeout: 15000,
  });
  try {
    return await fn(pool);
  } finally {
    await pool.close().catch(() => undefined);
  }
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

export async function getSqlServerOverview(
  config: SqlServerConfig
): Promise<SqlServerOverview> {
  return withPool(config, async (pool) => {
    const headResult = await pool.request().query<{
      version: string;
      product_version: string;
      edition: string;
      server_name: string;
      current_user: string;
      collation: string;
    }>(`
      SELECT
        @@VERSION AS version,
        CONVERT(NVARCHAR(128), SERVERPROPERTY('ProductVersion')) AS product_version,
        CONVERT(NVARCHAR(256), SERVERPROPERTY('Edition')) AS edition,
        CONVERT(NVARCHAR(256), SERVERPROPERTY('ServerName')) AS server_name,
        SUSER_SNAME() AS current_user,
        CONVERT(NVARCHAR(128), SERVERPROPERTY('Collation')) AS collation
    `);
    const head = headResult.recordset[0] ?? {
      version: "unknown",
      product_version: null,
      edition: null,
      server_name: null,
      current_user: null,
      collation: null,
    };

    let startTime: string | null = null;
    try {
      const startResult = await pool.request().query<{ start: Date }>(
        "SELECT sqlserver_start_time AS start FROM sys.dm_os_sys_info"
      );
      const raw = startResult.recordset[0]?.start;
      startTime = raw ? new Date(raw).toISOString() : null;
    } catch {
      // Permissions / Azure restrictions — ignore.
    }

    const databases = await fetchDatabaseStats(pool);

    return {
      version: String(head.version).split("\n")[0]?.trim() || "unknown",
      productVersion: head.product_version ?? null,
      edition: head.edition ?? null,
      serverName: head.server_name ?? null,
      currentUser: head.current_user ?? null,
      collation: head.collation ?? null,
      startTime,
      databaseCount: databases.length,
      topDatabases: databases.slice(0, 5),
    };
  });
}

export async function listSqlServerDatabases(
  config: SqlServerConfig
): Promise<SqlServerDatabaseSummary[]> {
  return withPool(config, (pool) => fetchDatabaseStats(pool));
}

async function fetchDatabaseStats(
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

  // Sort by size desc for callers that want a quick top-N.
  summaries.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return summaries;
}

export interface SqlServerTableSummary {
  name: string;
  schema: string;
  rows: number;
  sizeBytes: number;
}

export interface SqlServerDatabaseDetail {
  name: string;
  state: string;
  recoveryModel: string | null;
  compatibilityLevel: number | null;
  collation: string | null;
  sizeBytes: number;
  tableCount: number;
}

export interface SqlServerDatabaseDetailResult {
  database: SqlServerDatabaseDetail;
  tables: SqlServerTableSummary[];
}

// SQL Server identifier `[...]` quoting can't safely escape `]` inside the
// name in every code path, so we whitelist database names to the conservative
// SQL Server regular identifier alphabet. This is the only place we splice the
// name into SQL (for `USE [name]`); every value-only use goes through @db.
const SQLSERVER_DB_NAME_RE = /^[A-Za-z0-9_]+$/;

export async function listSqlServerTables(
  config: SqlServerConfig,
  database: string
): Promise<SqlServerDatabaseDetailResult> {
  if (!SQLSERVER_DB_NAME_RE.test(database)) {
    throw new Error(
      "Invalid database name (only letters, digits, and underscores are supported)"
    );
  }

  return withPool(config, async (pool) => {
    // Per-DB metadata is read from sys.databases on the server connection.
    // `sql.NVarChar` is attached at runtime via the dynamic types loop in
    // mssql/lib/base/index.js but mssql ships no .d.ts, so cast through any.
    const headResult = await pool
      .request()
      .input("db", (sql as unknown as { NVarChar: unknown }).NVarChar, database)
      .query<{
        name: string;
        state_desc: string;
        recovery_model_desc: string;
        compatibility_level: number;
        collation_name: string | null;
        size_bytes: string | number | null;
      }>(`
        SELECT
          d.name AS name,
          d.state_desc AS state_desc,
          d.recovery_model_desc AS recovery_model_desc,
          d.compatibility_level AS compatibility_level,
          d.collation_name AS collation_name,
          (
            SELECT SUM(CAST(size AS BIGINT) * 8192)
            FROM sys.master_files mf
            WHERE mf.database_id = d.database_id
          ) AS size_bytes
        FROM sys.databases d
        WHERE d.name = @db
      `);
    if (headResult.recordset.length === 0) {
      throw new Error(`Database "${database}" not found`);
    }
    const head = headResult.recordset[0];

    // Per-table rows + reserved size. sys.tables / sys.schemas / sys.partitions
    // / sys.allocation_units are per-database, so we switch context with
    // `USE [dbname]`. The name has already been validated against
    // SQLSERVER_DB_NAME_RE above.
    const tablesResult = await pool.request().query<{
      schema_name: string;
      table_name: string;
      row_count: string | number;
      reserved_bytes: string | number | null;
    }>(`
      USE [${database}];
      SELECT
        s.name AS schema_name,
        t.name AS table_name,
        SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END) AS row_count,
        SUM(CAST(a.total_pages AS BIGINT)) * 8192 AS reserved_bytes
      FROM sys.tables t
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      LEFT JOIN sys.partitions p ON p.object_id = t.object_id
      LEFT JOIN sys.allocation_units a ON a.container_id = p.partition_id
      WHERE t.is_ms_shipped = 0
      GROUP BY s.name, t.name
      ORDER BY s.name, t.name;
    `);

    const tables: SqlServerTableSummary[] = tablesResult.recordset.map(
      (row) => ({
        schema: String(row.schema_name),
        name: String(row.table_name),
        rows: Number(row.row_count ?? 0),
        sizeBytes: Number(row.reserved_bytes ?? 0),
      })
    );

    return {
      database: {
        name: String(head.name),
        state: String(head.state_desc ?? "UNKNOWN"),
        recoveryModel: head.recovery_model_desc
          ? String(head.recovery_model_desc)
          : null,
        compatibilityLevel:
          head.compatibility_level != null
            ? Number(head.compatibility_level)
            : null,
        collation: head.collation_name ? String(head.collation_name) : null,
        sizeBytes: Number(head.size_bytes ?? 0),
        tableCount: tables.length,
      },
      tables,
    };
  });
}
