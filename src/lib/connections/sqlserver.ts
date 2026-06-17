import type { ConnectionPool } from "mssql"; // type-only — erased at build, safe when mssql absent
import { DriverNotInstalledError } from "@/techs/contract";

let _mssqlMod: typeof import("mssql") | null = null;
async function getMssql(): Promise<typeof import("mssql")> {
  try {
    return (_mssqlMod ??= await import("mssql"));
  } catch {
    throw new DriverNotInstalledError("sqlserver", "mssql");
  }
}
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
  /** Computed from startTime; 0 if startTime is unavailable. */
  uptimeSeconds: number;
  databaseCount: number;
  /** Sum of allocated size across ALL databases (not just topDatabases). */
  totalDatabasesSize: number;
  topDatabases: SqlServerDatabaseSummary[];
  // Connections (@@MAX_CONNECTIONS + sys.dm_exec_sessions).
  maxConnections: number;
  activeConnections: number;
  idleConnections: number;
  /** Buffer cache hit ratio 0..1, or null if perfmon counters aren't reachable. */
  cacheHitRatio: number | null;
}

export interface SqlServerProbeResult {
  version: string;
  databaseCount: number;
}

async function withPool<T>(
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
    // Note: `current_user` is a reserved built-in function in T-SQL and
    // can't be used as a bare column alias — use `login_name` instead.
    const headResult = await pool.request().query<{
      version: string;
      product_version: string;
      edition: string;
      server_name: string;
      login_name: string;
      collation: string;
    }>(`
      SELECT
        @@VERSION AS version,
        CONVERT(NVARCHAR(128), SERVERPROPERTY('ProductVersion')) AS product_version,
        CONVERT(NVARCHAR(256), SERVERPROPERTY('Edition')) AS edition,
        CONVERT(NVARCHAR(256), SERVERPROPERTY('ServerName')) AS server_name,
        SUSER_SNAME() AS login_name,
        CONVERT(NVARCHAR(128), SERVERPROPERTY('Collation')) AS collation
    `);
    const head = headResult.recordset[0] ?? {
      version: "unknown",
      product_version: null,
      edition: null,
      server_name: null,
      login_name: null,
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

    // Connections: @@MAX_CONNECTIONS for the cap; sessions bucketed by status.
    // Excludes internal background sessions (is_user_process = 0).
    let maxConnections = 0;
    let activeConnections = 0;
    let idleConnections = 0;
    try {
      const connRes = await pool.request().query<{
        max_conn: number;
        active: number;
        idle: number;
      }>(`
        SELECT
          @@MAX_CONNECTIONS AS max_conn,
          SUM(CASE WHEN s.status = 'running' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN s.status = 'sleeping' THEN 1 ELSE 0 END) AS idle
        FROM sys.dm_exec_sessions s
        WHERE s.is_user_process = 1
      `);
      const row = connRes.recordset[0];
      if (row) {
        maxConnections = Number(row.max_conn ?? 0);
        activeConnections = Number(row.active ?? 0);
        idleConnections = Number(row.idle ?? 0);
      }
    } catch {
      // Some Azure SQL DB tiers restrict @@MAX_CONNECTIONS — leave zeros.
    }

    // Buffer cache hit ratio from perfmon. Modern SQL Server reports two
    // counters and the ratio is hit/base, not the raw "ratio" counter (which
    // is a moving int). Returning a 0..1 fraction so the UI formats it.
    let cacheHitRatio: number | null = null;
    try {
      const cacheRes = await pool.request().query<{
        ratio: number;
        base: number;
      }>(`
        SELECT
          (SELECT cntr_value FROM sys.dm_os_performance_counters
            WHERE counter_name = 'Buffer cache hit ratio'
              AND object_name LIKE '%Buffer Manager%') AS ratio,
          (SELECT cntr_value FROM sys.dm_os_performance_counters
            WHERE counter_name = 'Buffer cache hit ratio base'
              AND object_name LIKE '%Buffer Manager%') AS base
      `);
      const row = cacheRes.recordset[0];
      if (row && Number(row.base) > 0) {
        cacheHitRatio = Number(row.ratio) / Number(row.base);
      }
    } catch {
      // VIEW SERVER STATE permission missing — leave null.
    }

    const databases = await fetchDatabaseStats(pool);
    const totalDatabasesSize = databases.reduce((s, d) => s + d.sizeBytes, 0);
    const uptimeSeconds = startTime
      ? Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000))
      : 0;

    return {
      version: String(head.version).split("\n")[0]?.trim() || "unknown",
      productVersion: head.product_version ?? null,
      edition: head.edition ?? null,
      serverName: head.server_name ?? null,
      currentUser: head.login_name ?? null,
      collation: head.collation ?? null,
      startTime,
      uptimeSeconds,
      databaseCount: databases.length,
      totalDatabasesSize,
      topDatabases: databases.slice(0, 5),
      maxConnections,
      activeConnections,
      idleConnections,
      cacheHitRatio,
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

  // Return alphabetically by name (the query already ORDER BY d.name).
  summaries.sort((a, b) => a.name.localeCompare(b.name));
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
export const SQLSERVER_DB_NAME_RE = /^[A-Za-z0-9_]+$/;

/** @internal — exported for tests. */
export function validateSqlServerDatabaseName(name: string): string {
  if (!SQLSERVER_DB_NAME_RE.test(name)) {
    throw new Error(
      "Invalid database name (only letters, digits, and underscores are supported)",
    );
  }
  return name;
}

/**
 * Create a database. Runs `CREATE DATABASE [name]` against `master`. The name
 * is whitelisted to the regular-identifier alphabet (letters/digits/underscore)
 * before being spliced into the bracketed identifier — `]` injection is
 * therefore impossible, which is the same guard `USE [name]` relies on.
 */
export async function createSqlServerDatabase(
  config: SqlServerConfig,
  name: string
): Promise<void> {
  validateSqlServerDatabaseName(name);
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(`CREATE DATABASE [${name}]`);
    },
    { database: "master" }
  );
}

/**
 * Reject `;` in free-form SQL fragments (column types, DEFAULT expressions).
 * T-SQL lets `;` separate statements, so blocking it is the SQLi guard for
 * fragments that can't be parameterized — mirrors the Postgres adapter.
 */
export function requireNoStatementTerminator(value: string, fieldName: string): string {
  if (value.includes(";")) {
    throw new Error(`${fieldName} cannot contain ';'`);
  }
  return value;
}

export interface CreateSqlServerColumnInput {
  name: string;
  dataType: string;
  nullable: boolean;
  default?: string;
  isPrimaryKey: boolean;
  identity: boolean;
}

export interface CreateSqlServerTableInput {
  schema: string;
  name: string;
  columns: CreateSqlServerColumnInput[];
  ifNotExists?: boolean;
}

/**
 * Build + run a `CREATE TABLE [schema].[table] (...)`. Identifiers (schema /
 * table / column) are whitelisted then bracket-quoted; column types and
 * DEFAULT expressions are free-form fragments guarded against `;`.
 */
export async function createSqlServerTable(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerTableInput
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Table name is required");
  const table = validateSqlServerIdentifier(input.name.trim(), "table name");
  if (!input.columns.length) throw new Error("At least one column is required");

  const seen = new Set<string>();
  const colDefs = input.columns.map((c) => {
    const name = validateSqlServerIdentifier(c.name.trim(), "column name");
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate column name "${name}"`);
    seen.add(key);
    if (!c.dataType.trim()) throw new Error(`Column "${name}" needs a data type`);

    const parts = [`[${name}]`, requireNoStatementTerminator(c.dataType.trim(), "Column type")];
    if (c.identity) parts.push("IDENTITY(1,1)");
    parts.push(c.nullable ? "NULL" : "NOT NULL");
    if (c.default && c.default.trim()) {
      parts.push(`DEFAULT (${requireNoStatementTerminator(c.default.trim(), "Default expression")})`);
    }
    return parts.join(" ");
  });

  const pkCols = input.columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length) {
    const cols = pkCols
      .map((c) => `[${validateSqlServerIdentifier(c.name.trim(), "column name")}]`)
      .join(", ");
    colDefs.push(`PRIMARY KEY (${cols})`);
  }

  const create = `CREATE TABLE [${schema}].[${table}] (\n  ${colDefs.join(",\n  ")}\n)`;
  // No native CREATE TABLE IF NOT EXISTS in T-SQL — guard with OBJECT_ID. The
  // identifiers are whitelisted alnum/underscore, so embedding them in the
  // N'…' literal can't break out of the string.
  const sql = input.ifNotExists
    ? `IF OBJECT_ID(N'[${schema}].[${table}]', N'U') IS NULL\n${create}`
    : create;

  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database }
  );
}

/**
 * Drop a database. Runs on `master`. With `force`, first flips the database to
 * SINGLE_USER WITH ROLLBACK IMMEDIATE to terminate active connections (SQL
 * Server refuses DROP DATABASE while sessions are connected) — the analogue of
 * Postgres's "force / terminate connections".
 */
export async function dropSqlServerDatabase(
  config: SqlServerConfig,
  name: string,
  opts?: { force?: boolean }
): Promise<void> {
  validateSqlServerDatabaseName(name);
  const sql = opts?.force
    ? `ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}];`
    : `DROP DATABASE [${name}]`;
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database: "master" }
  );
}

/** Drop a schema (must be empty — SQL Server has no cascading DROP SCHEMA). */
export async function dropSqlServerSchema(
  config: SqlServerConfig,
  database: string,
  schema: string
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(`DROP SCHEMA [${schema}]`);
    },
    { database }
  );
}

const DROP_KEYWORD: Record<string, string> = {
  table: "TABLE",
  view: "VIEW",
  proc: "PROCEDURE",
  scalar_fn: "FUNCTION",
  table_fn: "FUNCTION",
  trigger: "TRIGGER",
  synonym: "SYNONYM",
  sequence: "SEQUENCE",
  type: "TYPE",
  table_type: "TYPE",
};

/** Drop a schema-scoped object (table / view / proc / function / trigger / synonym). */
export async function dropSqlServerObject(
  config: SqlServerConfig,
  database: string,
  object: { schema: string; name: string; kind: string }
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(object.schema, "schema name");
  const name = validateSqlServerIdentifier(object.name, "object name");
  const keyword = DROP_KEYWORD[object.kind];
  if (!keyword) throw new Error(`Cannot drop object of kind "${object.kind}"`);
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(`DROP ${keyword} [${schema}].[${name}]`);
    },
    { database }
  );
}

// ─── Row CRUD (insert / update / delete) ──────────────────────────────────
//
// Mirrors the Postgres driver's shape so the row-form-dialog UI can share
// types (ColumnValue / PrimaryKeyValue) without translation. Identifiers go
// through validateSqlServerIdentifier + bracket quoting; values go through
// mssql's parameterised .input() so they can't escape the value context.

export type SqlServerColumnValue =
  | { kind: "null" }
  | { kind: "default" }
  | { kind: "value"; value: string };

export interface SqlServerPrimaryKeyValue {
  column: string;
  value: unknown;
}

export async function insertSqlServerRow(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  values: Record<string, SqlServerColumnValue>,
): Promise<{ rowsAffected: number }> {
  validateSqlServerIdentifier(database, "database name");
  const s = validateSqlServerIdentifier(schema, "schema name");
  const t = validateSqlServerIdentifier(table, "table name");

  const cols: string[] = [];
  const placeholders: string[] = [];
  const paramSpecs: Array<{ name: string; value: unknown }> = [];
  for (const [col, v] of Object.entries(values)) {
    if (v.kind === "default") continue;
    const cn = validateSqlServerIdentifier(col, "column name");
    cols.push(`[${cn}]`);
    const pName = `p${paramSpecs.length}`;
    placeholders.push(`@${pName}`);
    paramSpecs.push({
      name: pName,
      value: v.kind === "null" ? null : v.value,
    });
  }

  const sql =
    cols.length === 0
      ? `INSERT INTO [${database}].[${s}].[${t}] DEFAULT VALUES`
      : `INSERT INTO [${database}].[${s}].[${t}] (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`;

  return withPool(
    config,
    async (pool) => {
      const req = pool.request();
      for (const p of paramSpecs) req.input(p.name, p.value);
      const res = await req.query(sql);
      return { rowsAffected: res.rowsAffected[0] ?? 0 };
    },
    { database },
  );
}

export async function updateSqlServerRow(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  pk: SqlServerPrimaryKeyValue[],
  values: Record<string, SqlServerColumnValue>,
): Promise<{ rowsAffected: number }> {
  if (pk.length === 0) {
    throw new Error("Cannot update: no primary key on this table");
  }
  validateSqlServerIdentifier(database, "database name");
  const s = validateSqlServerIdentifier(schema, "schema name");
  const t = validateSqlServerIdentifier(table, "table name");

  const sets: string[] = [];
  const paramSpecs: Array<{ name: string; value: unknown }> = [];
  for (const [col, v] of Object.entries(values)) {
    if (v.kind === "default") continue;
    const cn = validateSqlServerIdentifier(col, "column name");
    const pName = `p${paramSpecs.length}`;
    sets.push(`[${cn}] = @${pName}`);
    paramSpecs.push({
      name: pName,
      value: v.kind === "null" ? null : v.value,
    });
  }
  if (sets.length === 0) throw new Error("No columns to update");

  const wheres = pk.map((item) => {
    const cn = validateSqlServerIdentifier(item.column, "primary-key column");
    const pName = `p${paramSpecs.length}`;
    paramSpecs.push({ name: pName, value: item.value });
    return `[${cn}] = @${pName}`;
  });
  const sql = `UPDATE [${database}].[${s}].[${t}] SET ${sets.join(", ")} WHERE ${wheres.join(" AND ")}`;

  return withPool(
    config,
    async (pool) => {
      const req = pool.request();
      for (const p of paramSpecs) req.input(p.name, p.value);
      const res = await req.query(sql);
      return { rowsAffected: res.rowsAffected[0] ?? 0 };
    },
    { database },
  );
}

export async function deleteSqlServerRow(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  pk: SqlServerPrimaryKeyValue[],
): Promise<{ rowsAffected: number }> {
  if (pk.length === 0) {
    throw new Error("Cannot delete: no primary key on this table");
  }
  validateSqlServerIdentifier(database, "database name");
  const s = validateSqlServerIdentifier(schema, "schema name");
  const t = validateSqlServerIdentifier(table, "table name");

  const paramSpecs: Array<{ name: string; value: unknown }> = [];
  const wheres = pk.map((item) => {
    const cn = validateSqlServerIdentifier(item.column, "primary-key column");
    const pName = `p${paramSpecs.length}`;
    paramSpecs.push({ name: pName, value: item.value });
    return `[${cn}] = @${pName}`;
  });
  const sql = `DELETE FROM [${database}].[${s}].[${t}] WHERE ${wheres.join(" AND ")}`;

  return withPool(
    config,
    async (pool) => {
      const req = pool.request();
      for (const p of paramSpecs) req.input(p.name, p.value);
      const res = await req.query(sql);
      return { rowsAffected: res.rowsAffected[0] ?? 0 };
    },
    { database },
  );
}

// ─── Alter table (add / drop / rename / change column) ──────────────────
//
// Mirrors the Postgres ALTER pipeline (modify-table-dialog → PATCH route).
// Each op is one T-SQL statement; all of them run inside a single
// transaction so partial failures roll back cleanly.
//
// T-SQL quirks worth noting:
// - Adding a column uses `ADD` (no `COLUMN` keyword).
// - Renaming uses sp_rename — no native `RENAME COLUMN` syntax.
// - ALTER COLUMN must re-state the type even when only nullability is
//   changing, so this driver collapses "type + nullable" into one op
//   (alterColumn) rather than Postgres's split setNotNull/dropNotNull.

export type SqlServerAlterTableOp =
  | {
      kind: "addColumn";
      name: string;
      dataType: string;
      nullable: boolean;
      default?: string;
    }
  | { kind: "dropColumn"; name: string }
  | { kind: "renameColumn"; from: string; to: string }
  | {
      kind: "alterColumn";
      name: string;
      dataType: string;
      nullable: boolean;
    };

function alterTableSql(
  database: string,
  schema: string,
  table: string,
  op: SqlServerAlterTableOp,
): string {
  const fqn = `[${database}].[${schema}].[${table}]`;
  switch (op.kind) {
    case "addColumn": {
      const col = validateSqlServerIdentifier(op.name, "column name");
      const t = requireNoStatementTerminator(op.dataType.trim(), "Column type");
      const parts = [`ALTER TABLE ${fqn} ADD [${col}] ${t}`];
      parts.push(op.nullable ? "NULL" : "NOT NULL");
      if (op.default && op.default.trim()) {
        parts.push(
          `DEFAULT (${requireNoStatementTerminator(op.default.trim(), "Default expression")})`,
        );
      }
      return parts.join(" ");
    }
    case "dropColumn": {
      const col = validateSqlServerIdentifier(op.name, "column name");
      return `ALTER TABLE ${fqn} DROP COLUMN [${col}]`;
    }
    case "renameColumn": {
      const from = validateSqlServerIdentifier(op.from, "column name");
      const to = validateSqlServerIdentifier(op.to, "column name");
      // sp_rename is a stored proc — we send the qualifier as an N'…'
      // literal. The pieces are alnum/underscore via the validator so
      // they can't break out of the string literal.
      return `EXEC sp_rename N'${schema}.${table}.${from}', N'${to}', N'COLUMN'`;
    }
    case "alterColumn": {
      const col = validateSqlServerIdentifier(op.name, "column name");
      const t = requireNoStatementTerminator(op.dataType.trim(), "Column type");
      return `ALTER TABLE ${fqn} ALTER COLUMN [${col}] ${t} ${
        op.nullable ? "NULL" : "NOT NULL"
      }`;
    }
  }
}

export async function alterSqlServerTable(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  ops: SqlServerAlterTableOp[],
): Promise<{ applied: number }> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(table, "table name");
  if (ops.length === 0) return { applied: 0 };

  // Order: DROP → ALTER → RENAME → ADD. Same shape as the Postgres
  // pipeline so a sequence of changes from one form submission applies
  // in a sensible order (drops free up names before adds, renames after
  // any column-level alters so we still reference the original name).
  const drops = ops.filter((o) => o.kind === "dropColumn");
  const alters = ops.filter((o) => o.kind === "alterColumn");
  const renames = ops.filter((o) => o.kind === "renameColumn");
  const adds = ops.filter((o) => o.kind === "addColumn");
  const ordered = [...drops, ...alters, ...renames, ...adds];

  const sql = [
    "BEGIN TRANSACTION;",
    ...ordered.map((op) => alterTableSql(database, schema, table, op) + ";"),
    "COMMIT TRANSACTION;",
  ].join("\n");

  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database },
  );
  return { applied: ordered.length };
}

// ─── Create: sequence / synonym / type / table-type / arbitrary DDL ──────
//
// Each helper whitelists identifiers (schema, name, column names) and rejects
// `;` from free-form fragments (data types, default expressions, synonym
// targets) — mirroring the createSqlServerTable pattern. The exception is
// `executeSqlServerDdl`, which runs an arbitrary user-authored CREATE batch
// (the "Script CREATE To" pattern from SSMS) and is intentionally
// unrestricted — same trust model as the SQL query editor.

const SEQUENCE_TYPE_RE = /^(bigint|int|smallint|tinyint|decimal\([\s\d,]+\)|numeric\([\s\d,]+\))$/i;
const INTEGER_RE = /^-?\d+$/;

export interface CreateSqlServerSequenceInput {
  schema: string;
  name: string;
  /** bigint (default) | int | smallint | tinyint | decimal(p,0) | numeric(p,0) */
  dataType?: string;
  startWith?: string;
  incrementBy?: string;
  /** null → NO MINVALUE; undefined → omit (server default) */
  minValue?: string | null;
  /** null → NO MAXVALUE; undefined → omit (server default) */
  maxValue?: string | null;
  /** true → CYCLE; false → NO CYCLE; undefined → omit */
  cycle?: boolean;
  /** number → CACHE n; null → NO CACHE; undefined → omit */
  cache?: number | null;
}

export async function createSqlServerSequence(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerSequenceInput,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Sequence name is required");
  const name = validateSqlServerIdentifier(input.name.trim(), "sequence name");

  const parts: string[] = [`CREATE SEQUENCE [${schema}].[${name}]`];
  if (input.dataType && input.dataType.trim()) {
    const t = input.dataType.trim();
    if (!SEQUENCE_TYPE_RE.test(t)) throw new Error(`Invalid sequence data type "${t}"`);
    parts.push(`AS ${t}`);
  }
  if (input.startWith && input.startWith.trim()) {
    if (!INTEGER_RE.test(input.startWith.trim())) throw new Error("START WITH must be an integer");
    parts.push(`START WITH ${input.startWith.trim()}`);
  }
  if (input.incrementBy && input.incrementBy.trim()) {
    if (!INTEGER_RE.test(input.incrementBy.trim())) throw new Error("INCREMENT BY must be an integer");
    parts.push(`INCREMENT BY ${input.incrementBy.trim()}`);
  }
  if (input.minValue !== undefined) {
    if (input.minValue === null) parts.push("NO MINVALUE");
    else {
      if (!INTEGER_RE.test(input.minValue.trim())) throw new Error("MINVALUE must be an integer");
      parts.push(`MINVALUE ${input.minValue.trim()}`);
    }
  }
  if (input.maxValue !== undefined) {
    if (input.maxValue === null) parts.push("NO MAXVALUE");
    else {
      if (!INTEGER_RE.test(input.maxValue.trim())) throw new Error("MAXVALUE must be an integer");
      parts.push(`MAXVALUE ${input.maxValue.trim()}`);
    }
  }
  if (input.cycle === true) parts.push("CYCLE");
  else if (input.cycle === false) parts.push("NO CYCLE");
  if (input.cache !== undefined) {
    if (input.cache === null) parts.push("NO CACHE");
    else {
      if (!Number.isInteger(input.cache) || input.cache < 0) {
        throw new Error("CACHE must be a non-negative integer");
      }
      parts.push(`CACHE ${input.cache}`);
    }
  }

  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(parts.join(" "));
    },
    { database },
  );
}

export interface CreateSqlServerSynonymInput {
  schema: string;
  name: string;
  /** Target object reference, e.g. `[db].[schema].[obj]` or `db.schema.obj`. */
  target: string;
}

export async function createSqlServerSynonym(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerSynonymInput,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Synonym name is required");
  const name = validateSqlServerIdentifier(input.name.trim(), "synonym name");
  if (!input.target.trim()) throw new Error("Target object is required");
  // Targets are 1- to 4-part references with brackets/dots; `;` is the only
  // character that lets a second statement piggyback, so block it.
  const target = requireNoStatementTerminator(input.target.trim(), "Target");

  await withPool(
    config,
    async (pool) => {
      await pool
        .request()
        .batch(`CREATE SYNONYM [${schema}].[${name}] FOR ${target}`);
    },
    { database },
  );
}

export interface CreateSqlServerTypeInput {
  schema: string;
  name: string;
  /** Base type, e.g. `nvarchar(50)`, `decimal(18,2)`, `int`. */
  baseType: string;
  nullable: boolean;
}

export async function createSqlServerType(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerTypeInput,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Type name is required");
  const name = validateSqlServerIdentifier(input.name.trim(), "type name");
  if (!input.baseType.trim()) throw new Error("Base type is required");
  const baseType = requireNoStatementTerminator(input.baseType.trim(), "Base type");
  const nullability = input.nullable ? "NULL" : "NOT NULL";

  await withPool(
    config,
    async (pool) => {
      await pool
        .request()
        .batch(`CREATE TYPE [${schema}].[${name}] FROM ${baseType} ${nullability}`);
    },
    { database },
  );
}

export interface CreateSqlServerTableTypeInput {
  schema: string;
  name: string;
  columns: CreateSqlServerColumnInput[];
}

export async function createSqlServerTableType(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerTableTypeInput,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Type name is required");
  const name = validateSqlServerIdentifier(input.name.trim(), "type name");
  if (!input.columns.length) throw new Error("At least one column is required");

  const seen = new Set<string>();
  const colDefs = input.columns.map((c) => {
    const cname = validateSqlServerIdentifier(c.name.trim(), "column name");
    const key = cname.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate column name "${cname}"`);
    seen.add(key);
    if (!c.dataType.trim()) throw new Error(`Column "${cname}" needs a data type`);
    const parts = [`[${cname}]`, requireNoStatementTerminator(c.dataType.trim(), "Column type")];
    parts.push(c.nullable ? "NULL" : "NOT NULL");
    if (c.default && c.default.trim()) {
      parts.push(
        `DEFAULT (${requireNoStatementTerminator(c.default.trim(), "Default expression")})`,
      );
    }
    return parts.join(" ");
  });

  const pkCols = input.columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length) {
    const cols = pkCols
      .map((c) => `[${validateSqlServerIdentifier(c.name.trim(), "column name")}]`)
      .join(", ");
    colDefs.push(`PRIMARY KEY (${cols})`);
  }

  const sql = `CREATE TYPE [${schema}].[${name}] AS TABLE (\n  ${colDefs.join(",\n  ")}\n)`;
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database },
  );
}

/**
 * Run an arbitrary single-batch DDL statement against a database. Used by the
 * "Create View / Procedure / Function / Trigger" dialogs, which let the user
 * edit a CREATE template directly — same trust model as the SQL query editor
 * (the user is intentionally authoring T-SQL).
 */
export async function executeSqlServerDdl(
  config: SqlServerConfig,
  database: string,
  sql: string,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  if (!sql.trim()) throw new Error("Script is empty");
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database },
  );
}

/**
 * List user schemas in a database (dbo + custom), excluding the built-in
 * system schemas and the nine fixed database-role schemas. Used by the sidebar
 * tree so empty / freshly-created schemas show up (object listing alone would
 * only surface schemas that already contain something).
 */
export async function listSqlServerSchemas(
  config: SqlServerConfig,
  database: string
): Promise<string[]> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      const res = await pool.request().query<{ name: string }>(`
        SELECT name FROM sys.schemas
        WHERE name NOT IN (
          'guest','sys','INFORMATION_SCHEMA',
          'db_owner','db_accessadmin','db_securityadmin','db_ddladmin',
          'db_backupoperator','db_datareader','db_datawriter',
          'db_denydatareader','db_denydatawriter'
        )
        ORDER BY name
      `);
      return res.recordset.map((r) => String(r.name));
    },
    { database }
  );
}

/**
 * Bulk-list every table/view in a schema with their columns. Used to feed the
 * SQL editor's autocomplete in one round-trip instead of N per-table calls.
 * Schema is parameterized (not spliced) so we don't need the identifier
 * whitelist here — the value never reaches the SQL text.
 */
export async function listSqlServerSchemaColumns(
  config: SqlServerConfig,
  database: string,
  schema: string,
): Promise<Array<{ name: string; columns: string[] }>> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      const res = await pool
        .request()
        .input(
          "schema",
          ((await getMssql()).default as unknown as { NVarChar: unknown }).NVarChar,
          schema,
        )
        .query<{ table_name: string; column_name: string }>(`
          SELECT o.name AS table_name, c.name AS column_name
          FROM sys.objects o
          JOIN sys.columns c ON c.object_id = o.object_id
          WHERE SCHEMA_NAME(o.schema_id) = @schema
            AND o.type IN ('U','V')
          ORDER BY o.name, c.column_id
        `);
      const map = new Map<string, string[]>();
      for (const row of res.recordset) {
        const arr = map.get(row.table_name) ?? [];
        arr.push(row.column_name);
        map.set(row.table_name, arr);
      }
      return [...map.entries()].map(([name, columns]) => ({ name, columns }));
    },
    { database },
  );
}

/**
 * Create a schema in `database`. `CREATE SCHEMA` must be the only statement in
 * its batch, so it runs on its own. Both identifiers are whitelisted before
 * splicing (see {@link createSqlServerDatabase}).
 */
export async function createSqlServerSchema(
  config: SqlServerConfig,
  database: string,
  schema: string
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(`CREATE SCHEMA [${schema}]`);
    },
    { database }
  );
}

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
      .input("db", ((await getMssql()).default as unknown as { NVarChar: unknown }).NVarChar, database)
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

// ─── Query editor: GO-aware batch execution ─────────────────────────────

export interface SqlServerResultSet {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

export interface SqlServerBatchResult {
  /** The batch text that produced this result (trimmed). */
  sql: string;
  /** One entry per recordset the batch returned (a proc can emit several). */
  resultSets: SqlServerResultSet[];
  /** rowsAffected per statement in the batch. */
  rowsAffected: number[];
  /** SET STATISTICS IO/TIME + PRINT output emitted while running. */
  messages: string[];
  durationMs: number;
  error?: string;
}

export interface SqlServerMultiResult {
  batches: SqlServerBatchResult[];
  totalDurationMs: number;
}

const MAX_RESULT_ROWS = 1000;

/**
 * Split a T-SQL script into batches on `GO` (the SSMS/sqlcmd batch
 * separator), which the TDS protocol never sees — `mssql` will throw if you
 * send it. A line of just `GO` (optionally `GO <count>` to repeat) ends a
 * batch. `;` does NOT split batches. Respects single-quoted strings, bracket
 * identifiers, and `--` / block comments so a `GO` inside those is ignored.
 */
export function splitGoBatches(script: string): Array<{ sql: string; count: number }> {
  const lines = script.split(/\r?\n/);
  const out: Array<{ sql: string; count: number }> = [];
  let buf: string[] = [];
  // Track block-comment depth across lines (T-SQL allows nested /* */).
  let blockDepth = 0;

  const isGoLine = (line: string): { go: boolean; count: number } => {
    // GO only counts when the line — outside any block comment — is just
    // `GO` with optional whitespace and an optional repeat count.
    if (blockDepth > 0) return { go: false, count: 1 };
    const m = line.match(/^\s*GO\s*(\d+)?\s*(?:--.*)?$/i);
    if (!m) return { go: false, count: 1 };
    return { go: true, count: m[1] ? Math.max(1, parseInt(m[1], 10)) : 1 };
  };

  // Update blockDepth for a line (rough scan; good enough to keep a stray
  // GO inside /* */ from splitting).
  const scanBlock = (line: string) => {
    let i = 0;
    while (i < line.length) {
      if (blockDepth > 0) {
        const close = line.indexOf("*/", i);
        if (close === -1) return;
        blockDepth -= 1;
        i = close + 2;
      } else {
        const open = line.indexOf("/*", i);
        const lineComment = line.indexOf("--", i);
        if (open === -1) return;
        if (lineComment !== -1 && lineComment < open) return; // rest is // comment
        blockDepth += 1;
        i = open + 2;
      }
    }
  };

  for (const line of lines) {
    const { go, count } = isGoLine(line);
    if (go) {
      const sql = buf.join("\n").trim();
      if (sql) out.push({ sql, count });
      buf = [];
      continue;
    }
    buf.push(line);
    scanBlock(line);
  }
  const tail = buf.join("\n").trim();
  if (tail) out.push({ sql: tail, count: 1 });
  return out;
}

/**
 * Run a T-SQL script as a sequence of GO-delimited batches and return one
 * result per batch. Errors are captured per-batch (execution continues).
 * Optionally prepends SET STATISTICS IO/TIME so the messages stream carries
 * the logical-reads / elapsed numbers developers compare rewrites with.
 */
export async function runSqlServerScript(
  config: SqlServerConfig,
  database: string | undefined,
  script: string,
  opts: { statistics?: boolean } = {},
): Promise<SqlServerMultiResult> {
  const db = database && SQLSERVER_DB_NAME_RE.test(database) ? database : undefined;
  return withPool(
    config,
    async (pool) => {
      const overall = Date.now();
      const batches = splitGoBatches(script);
      const out: SqlServerBatchResult[] = [];
      for (const batch of batches) {
        for (let rep = 0; rep < batch.count; rep++) {
          const start = Date.now();
          const messages: string[] = [];
          const req = pool.request();
          // mssql's Request extends EventEmitter and emits 'info' for PRINT /
          // STATISTICS output, but the bundled types don't declare `.on`.
          (req as unknown as {
            on: (ev: string, cb: (info: { message?: string }) => void) => void;
          }).on("info", (info) => {
            if (info?.message) messages.push(info.message);
          });
          const text = opts.statistics
            ? `SET STATISTICS IO ON; SET STATISTICS TIME ON;\n${batch.sql}`
            : batch.sql;
          try {
            const res = await req.batch(text);
            // mssql exposes recordsets as an array; each has a `columns` map.
            const recordsets = (res.recordsets ?? []) as unknown as Array<
              Array<Record<string, unknown>> & {
                columns?: Record<string, unknown>;
              }
            >;
            const resultSets: SqlServerResultSet[] = recordsets.map((rs) => {
              const fields = rs.columns ? Object.keys(rs.columns) : rs[0] ? Object.keys(rs[0]) : [];
              const sliced = rs.slice(0, MAX_RESULT_ROWS);
              return {
                fields,
                rows: sliced.map((row) => fields.map((f) => row[f] ?? null)),
                rowCount: rs.length,
                truncated: rs.length > sliced.length,
              };
            });
            out.push({
              sql: batch.sql,
              resultSets,
              rowsAffected: res.rowsAffected ?? [],
              messages,
              durationMs: Date.now() - start,
            });
          } catch (err) {
            out.push({
              sql: batch.sql,
              resultSets: [],
              rowsAffected: [],
              messages,
              durationMs: Date.now() - start,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      return { batches: out, totalDurationMs: Date.now() - overall };
    },
    { database: db, requestTimeoutMs: 60_000 },
  );
}

// ─── Read-only query helper (AI tools path) ─────────────────────────────

export interface ReadOnlyResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
}

// Defense-in-depth denylist for the read-only AI query path. The rollback wrap
// below is the real backstop; this just rejects obvious writes early. `_` is a
// word char so this won't trip on column names like `update_time`.
const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|drop|create|alter|truncate|exec|execute|grant|revoke|into|sp_|xp_)\b/i;

/**
 * Run a single read-only statement. SQL Server has no READ ONLY transaction, so
 * we (1) block ';' (single statement), (2) reject write keywords, and (3) wrap in
 * BEGIN TRAN … ROLLBACK so anything that slips past still never persists.
 */
export async function runReadOnlyQuery(
  config: SqlServerConfig,
  database: string,
  sql: string,
  maxRows = 1000,
): Promise<ReadOnlyResult> {
  const single = requireNoStatementTerminator(sql.trim().replace(/;+\s*$/g, ""), "Query");
  const m = single.match(WRITE_KEYWORDS);
  if (m) {
    throw new Error(`Read-only query rejected: contains a write keyword ("${m[0]}").`);
  }
  return withPool(
    config,
    async (pool) => {
      const res = await pool.request().batch(`BEGIN TRAN;\n${single};\nROLLBACK;`);
      const rs = (res.recordset ?? []) as unknown as Array<Record<string, unknown>> & {
        columns?: Record<string, unknown>;
      };
      const fields = rs.columns ? Object.keys(rs.columns) : rs[0] ? Object.keys(rs[0]) : [];
      const capped = rs.slice(0, maxRows);
      return {
        fields,
        rows: capped.map((row) => fields.map((f) => row[f] ?? null)),
        rowCount: capped.length,
      };
    },
    { database },
  );
}

// ─── Activity / sessions ────────────────────────────────────────────────

export interface SqlServerSession {
  sessionId: number;
  loginName: string | null;
  hostName: string | null;
  programName: string | null;
  databaseName: string | null;
  status: string | null;
  command: string | null;
  waitType: string | null;
  waitClass: string;
  blockingSessionId: number | null;
  cpuTime: number;
  reads: number;
  writes: number;
  openTransactions: number;
  lastRequestStart: string | null;
  elapsedMs: number | null;
  text: string | null;
  isUserProcess: boolean;
}

/** Bucket a SQL Server wait_type into a coarse class for grouping. */
export function classifyWait(waitType: string | null): string {
  if (!waitType) return "Running";
  const w = waitType.toUpperCase();
  if (w.startsWith("LCK_")) return "Lock";
  if (w.startsWith("PAGEIOLATCH") || w.startsWith("IO_") || w.startsWith("WRITELOG") || w.startsWith("ASYNC_IO"))
    return "IO";
  if (w.startsWith("CXPACKET") || w.startsWith("CXCONSUMER") || w.startsWith("EXCHANGE"))
    return "Parallelism";
  if (w.startsWith("PAGELATCH") || w.startsWith("LATCH_")) return "Latch";
  if (w.startsWith("RESOURCE_SEMAPHORE") || w.startsWith("CMEMTHREAD")) return "Memory";
  if (w.startsWith("ASYNC_NETWORK_IO") || w.startsWith("NETWORK")) return "Network";
  if (w.startsWith("SOS_SCHEDULER_YIELD") || w.startsWith("THREADPOOL")) return "CPU";
  return "Other";
}

export async function listSqlServerActivity(
  config: SqlServerConfig,
): Promise<SqlServerSession[]> {
  return withPool(config, async (pool) => {
    const res = await pool.request().query<{
      session_id: number;
      login_name: string | null;
      host_name: string | null;
      program_name: string | null;
      database_name: string | null;
      status: string | null;
      command: string | null;
      wait_type: string | null;
      blocking_session_id: number | null;
      cpu_time: number | null;
      reads: number | null;
      writes: number | null;
      open_transaction_count: number | null;
      last_request_start_time: Date | null;
      elapsed_ms: number | null;
      sql_text: string | null;
      is_user_process: boolean;
    }>(`
      SELECT
        s.session_id,
        s.login_name,
        s.host_name,
        s.program_name,
        DB_NAME(COALESCE(r.database_id, s.database_id)) AS database_name,
        COALESCE(r.status, s.status) AS status,
        r.command,
        r.wait_type,
        NULLIF(r.blocking_session_id, 0) AS blocking_session_id,
        s.cpu_time,
        s.reads,
        s.writes,
        s.open_transaction_count,
        s.last_request_start_time,
        r.total_elapsed_time AS elapsed_ms,
        t.text AS sql_text,
        CAST(s.is_user_process AS BIT) AS is_user_process
      FROM sys.dm_exec_sessions s
      LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
      OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
      WHERE s.session_id <> @@SPID
      ORDER BY s.is_user_process DESC, r.cpu_time DESC, s.cpu_time DESC
    `);
    return res.recordset.map((row) => ({
      sessionId: Number(row.session_id),
      loginName: row.login_name ?? null,
      hostName: row.host_name ?? null,
      programName: row.program_name ?? null,
      databaseName: row.database_name ?? null,
      status: row.status ?? null,
      command: row.command ?? null,
      waitType: row.wait_type ?? null,
      waitClass: row.wait_type ? classifyWait(row.wait_type) : (row.status === "running" ? "CPU" : "Idle"),
      blockingSessionId: row.blocking_session_id != null ? Number(row.blocking_session_id) : null,
      cpuTime: Number(row.cpu_time ?? 0),
      reads: Number(row.reads ?? 0),
      writes: Number(row.writes ?? 0),
      openTransactions: Number(row.open_transaction_count ?? 0),
      lastRequestStart: row.last_request_start_time
        ? new Date(row.last_request_start_time).toISOString()
        : null,
      elapsedMs: row.elapsed_ms != null ? Number(row.elapsed_ms) : null,
      text: row.sql_text ?? null,
      isUserProcess: Boolean(row.is_user_process),
    }));
  });
}

/** KILL a session by SPID. SPID is validated as an integer (no parameterization for KILL). */
export async function killSqlServerSession(
  config: SqlServerConfig,
  spid: number,
): Promise<void> {
  if (!Number.isInteger(spid) || spid <= 0) {
    throw new Error("Invalid session id");
  }
  await withPool(config, async (pool) => {
    await pool.request().batch(`KILL ${spid}`);
  });
}

// ─── Schema browser + table detail (Phase B) ─────────────────────────────

/** Conservative identifier whitelist for names spliced into SQL (USE / FROM). */
export function validateSqlServerIdentifier(name: string, kind = "identifier"): string {
  if (!SQLSERVER_DB_NAME_RE.test(name)) {
    throw new Error(`Invalid ${kind} (only letters, digits, and underscores are supported)`);
  }
  return name;
}

export interface SqlServerObject {
  schema: string;
  name: string;
  /** table | view | proc | scalar_fn | table_fn | trigger | synonym | sequence | type | table_type */
  kind: string;
  type: string; // raw sys.objects type code, trimmed
}

export async function listSqlServerObjects(
  config: SqlServerConfig,
  database: string,
): Promise<SqlServerObject[]> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      const res = await pool.request().query<{
        schema_name: string;
        name: string;
        type: string;
      }>(`
        SELECT s.name AS schema_name, o.name AS name, RTRIM(o.type) AS type
        FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.is_ms_shipped = 0
          AND o.type IN ('U','V','P','FN','IF','TF','TR','SN','SO','TT')
        UNION ALL
        SELECT s.name AS schema_name, sy.name AS name, 'SN' AS type
        FROM sys.synonyms sy
        JOIN sys.schemas s ON s.schema_id = sy.schema_id
        UNION ALL
        SELECT s.name AS schema_name, t.name AS name, 'UDT' AS type
        FROM sys.types t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE t.is_user_defined = 1 AND t.is_table_type = 0
        ORDER BY schema_name, name
      `);
      const kindOf = (t: string): string => {
        switch (t) {
          case "U": return "table";
          case "V": return "view";
          case "P": return "proc";
          case "FN": return "scalar_fn";
          case "IF":
          case "TF": return "table_fn";
          case "TR": return "trigger";
          case "SN": return "synonym";
          case "SO": return "sequence";
          case "TT": return "table_type";
          case "UDT": return "type";
          default: return t;
        }
      };
      // De-dup synonyms (the UNION can double them if also in sys.objects).
      const seen = new Set<string>();
      const out: SqlServerObject[] = [];
      for (const r of res.recordset) {
        const key = `${r.schema_name}.${r.name}.${r.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          schema: String(r.schema_name),
          name: String(r.name),
          kind: kindOf(String(r.type)),
          type: String(r.type),
        });
      }
      return out;
    },
    { database },
  );
}

export interface SqlServerColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  identitySeed: string | null;
  identityIncrement: string | null;
  isComputed: boolean;
  computedDefinition: string | null;
  isPrimaryKey: boolean;
  defaultDefinition: string | null;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
}

export interface SqlServerIndex {
  name: string;
  typeDesc: string; // CLUSTERED / NONCLUSTERED / HEAP / CLUSTERED COLUMNSTORE…
  isPrimaryKey: boolean;
  isUnique: boolean;
  keyColumns: string[];
  includedColumns: string[];
  sizeBytes: number;
  userSeeks: number;
  userScans: number;
  userLookups: number;
  userUpdates: number;
  unused: boolean;
}

export interface SqlServerConstraintRow {
  name: string;
  type: string; // CHECK / DEFAULT / PRIMARY KEY / UNIQUE
  definition: string;
}

export interface SqlServerForeignKeyRow {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface SqlServerTableDetail {
  schema: string;
  table: string;
  isHeap: boolean;
  rowCount: number;
  columns: SqlServerColumn[];
  indexes: SqlServerIndex[];
  constraints: SqlServerConstraintRow[];
  foreignKeys: SqlServerForeignKeyRow[];
}

export async function getSqlServerTableDetail(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
): Promise<SqlServerTableDetail> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(table, "table name");
  return withPool(
    config,
    async (pool) => {
      const objId = `OBJECT_ID('${schema}.${table}')`;

      const colsP = pool.request().query<{
        name: string;
        type_name: string;
        is_nullable: boolean;
        is_identity: boolean;
        seed_value: string | null;
        increment_value: string | null;
        is_computed: boolean;
        computed_def: string | null;
        max_length: number;
        precision: number;
        scale: number;
        is_pk: number;
        default_def: string | null;
      }>(`
        SELECT
          c.name AS name,
          TYPE_NAME(c.user_type_id) AS type_name,
          c.is_nullable, c.is_identity, c.is_computed,
          ic.seed_value, ic.increment_value,
          cc.definition AS computed_def,
          c.max_length, c.precision, c.scale,
          CASE WHEN EXISTS (
            SELECT 1 FROM sys.index_columns kc
            JOIN sys.indexes i ON i.object_id = kc.object_id AND i.index_id = kc.index_id
            WHERE kc.object_id = c.object_id AND kc.column_id = c.column_id AND i.is_primary_key = 1
          ) THEN 1 ELSE 0 END AS is_pk,
          dc.definition AS default_def
        FROM sys.columns c
        LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
        LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE c.object_id = ${objId}
        ORDER BY c.column_id
      `);

      const idxP = pool.request().query<{
        index_id: number;
        name: string | null;
        type_desc: string;
        is_primary_key: boolean;
        is_unique: boolean;
        key_cols: string | null;
        incl_cols: string | null;
        size_bytes: string | number | null;
        user_seeks: number | null;
        user_scans: number | null;
        user_lookups: number | null;
        user_updates: number | null;
      }>(`
        SELECT
          i.index_id, i.name, i.type_desc, i.is_primary_key, i.is_unique,
          (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
             FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
             WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0) AS key_cols,
          (SELECT STRING_AGG(c.name, ', ')
             FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
             WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1) AS incl_cols,
          (SELECT SUM(a.used_pages) * 8192 FROM sys.partitions p
             JOIN sys.allocation_units a ON a.container_id = p.partition_id
             WHERE p.object_id = i.object_id AND p.index_id = i.index_id) AS size_bytes,
          us.user_seeks, us.user_scans, us.user_lookups, us.user_updates
        FROM sys.indexes i
        LEFT JOIN sys.dm_db_index_usage_stats us
          ON us.object_id = i.object_id AND us.index_id = i.index_id AND us.database_id = DB_ID()
        WHERE i.object_id = ${objId}
        ORDER BY i.is_primary_key DESC, i.index_id
      `);

      const consP = pool.request().query<{
        name: string;
        type: string;
        definition: string;
      }>(`
        SELECT name, 'CHECK' AS type, definition FROM sys.check_constraints WHERE parent_object_id = ${objId}
        UNION ALL
        SELECT dc.name, 'DEFAULT' AS type, dc.definition FROM sys.default_constraints dc WHERE dc.parent_object_id = ${objId}
      `);

      const fkP = pool.request().query<{
        name: string;
        cols: string;
        ref_schema: string;
        ref_table: string;
        ref_cols: string;
        update_action: string;
        delete_action: string;
      }>(`
        SELECT
          fk.name,
          (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id)
             FROM sys.foreign_key_columns fkc JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
             WHERE fkc.constraint_object_id = fk.object_id) AS cols,
          rs.name AS ref_schema, rt.name AS ref_table,
          (SELECT STRING_AGG(rc.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id)
             FROM sys.foreign_key_columns fkc JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
             WHERE fkc.constraint_object_id = fk.object_id) AS ref_cols,
          fk.update_referential_action_desc AS update_action,
          fk.delete_referential_action_desc AS delete_action
        FROM sys.foreign_keys fk
        JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
        JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
        WHERE fk.parent_object_id = ${objId}
      `);

      const rowsP = pool.request().query<{ row_count: string | number }>(`
        SELECT SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS row_count
        FROM sys.partitions p WHERE p.object_id = ${objId}
      `);

      const [cols, idx, cons, fk, rowsR] = await Promise.all([colsP, idxP, consP, fkP, rowsP]);

      const columns: SqlServerColumn[] = cols.recordset.map((c) => ({
        name: String(c.name),
        dataType: String(c.type_name),
        nullable: Boolean(c.is_nullable),
        isIdentity: Boolean(c.is_identity),
        identitySeed: c.seed_value != null ? String(c.seed_value) : null,
        identityIncrement: c.increment_value != null ? String(c.increment_value) : null,
        isComputed: Boolean(c.is_computed),
        computedDefinition: c.computed_def ?? null,
        isPrimaryKey: Number(c.is_pk) === 1,
        defaultDefinition: c.default_def ?? null,
        maxLength: c.max_length != null ? Number(c.max_length) : null,
        precision: c.precision != null ? Number(c.precision) : null,
        scale: c.scale != null ? Number(c.scale) : null,
      }));

      const indexes: SqlServerIndex[] = idx.recordset
        .filter((i) => i.name != null || i.type_desc === "HEAP")
        .map((i) => {
          const seeks = Number(i.user_seeks ?? 0);
          const scans = Number(i.user_scans ?? 0);
          const lookups = Number(i.user_lookups ?? 0);
          const updates = Number(i.user_updates ?? 0);
          return {
            name: i.name ? String(i.name) : "(heap)",
            typeDesc: String(i.type_desc),
            isPrimaryKey: Boolean(i.is_primary_key),
            isUnique: Boolean(i.is_unique),
            keyColumns: i.key_cols ? String(i.key_cols).split(", ") : [],
            includedColumns: i.incl_cols ? String(i.incl_cols).split(", ") : [],
            sizeBytes: Number(i.size_bytes ?? 0),
            userSeeks: seeks,
            userScans: scans,
            userLookups: lookups,
            userUpdates: updates,
            unused: !i.is_primary_key && !i.is_unique && seeks + scans + lookups === 0 && updates > 0,
          };
        });

      const isHeap = indexes.some((i) => i.typeDesc === "HEAP");

      return {
        schema,
        table,
        isHeap,
        rowCount: Number(rowsR.recordset[0]?.row_count ?? 0),
        columns,
        indexes,
        constraints: cons.recordset.map((c) => ({
          name: String(c.name),
          type: String(c.type),
          definition: String(c.definition),
        })),
        foreignKeys: fk.recordset.map((f) => ({
          name: String(f.name),
          columns: f.cols ? String(f.cols).split(", ") : [],
          refSchema: String(f.ref_schema),
          refTable: String(f.ref_table),
          refColumns: f.ref_cols ? String(f.ref_cols).split(", ") : [],
          onUpdate: String(f.update_action),
          onDelete: String(f.delete_action),
        })),
      };
    },
    { database },
  );
}

export interface SqlServerTableData {
  fields: string[];
  rows: unknown[][];
  total: number;
}

/** Paged table data. OFFSET/FETCH needs an ORDER BY — falls back to (SELECT NULL) ordering. */
export async function getSqlServerTableData(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<SqlServerTableData> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(table, "table name");
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return withPool(
    config,
    async (pool) => {
      // 3-part naming so the query targets the right database even if the
      // global mssql pool was switched by a concurrent request between
      // withPool's connect and our query.
      const fqn = `[${database}].[${schema}].[${table}]`;
      const countR = await pool.request().query<{ n: string | number }>(
        `SELECT COUNT_BIG(*) AS n FROM ${fqn}`,
      );
      const total = Number(countR.recordset[0]?.n ?? 0);
      const dataR = await pool.request().query<Record<string, unknown>>(
        `SELECT * FROM ${fqn} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
      );
      const rs = dataR.recordset as unknown as Array<Record<string, unknown>> & {
        columns?: Record<string, unknown>;
      };
      const fields = rs.columns ? Object.keys(rs.columns) : rs[0] ? Object.keys(rs[0]) : [];
      return {
        fields,
        rows: rs.map((row) => fields.map((f) => row[f] ?? null)),
        total,
      };
    },
    { database },
  );
}

/** Reconstruct a CREATE TABLE script from catalog metadata (no SMO dependency). */
export function buildSqlServerTableDDL(detail: SqlServerTableDetail): string {
  const colLines = detail.columns.map((c) => {
    const parts = [`  [${c.name}]`];
    if (c.isComputed && c.computedDefinition) {
      parts.push(`AS ${c.computedDefinition}`);
    } else {
      parts.push(c.dataType);
      if (c.isIdentity) {
        parts.push(`IDENTITY(${c.identitySeed ?? 1},${c.identityIncrement ?? 1})`);
      }
      parts.push(c.nullable ? "NULL" : "NOT NULL");
      if (c.defaultDefinition) parts.push(`DEFAULT ${c.defaultDefinition}`);
    }
    return parts.join(" ");
  });

  const pkCols = detail.columns.filter((c) => c.isPrimaryKey).map((c) => `[${c.name}]`);
  const lines = [...colLines];
  if (pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.join(", ")})`);
  }

  const create = `CREATE TABLE [${detail.schema}].[${detail.table}] (\n${lines.join(",\n")}\n);`;

  const indexDdl = detail.indexes
    .filter((i) => !i.isPrimaryKey && i.name !== "(heap)" && i.keyColumns.length > 0)
    .map((i) => {
      const unique = i.isUnique ? "UNIQUE " : "";
      const clustered = i.typeDesc.includes("CLUSTERED") && !i.typeDesc.includes("NONCLUSTERED") ? "CLUSTERED " : "NONCLUSTERED ";
      const incl = i.includedColumns.length > 0 ? ` INCLUDE (${i.includedColumns.map((c) => `[${c}]`).join(", ")})` : "";
      return `CREATE ${unique}${clustered}INDEX [${i.name}] ON [${detail.schema}].[${detail.table}] (${i.keyColumns.map((c) => `[${c}]`).join(", ")})${incl};`;
    });

  const fkDdl = detail.foreignKeys.map(
    (f) =>
      `ALTER TABLE [${detail.schema}].[${detail.table}] ADD CONSTRAINT [${f.name}] FOREIGN KEY (${f.columns.map((c) => `[${c}]`).join(", ")}) REFERENCES [${f.refSchema}].[${f.refTable}] (${f.refColumns.map((c) => `[${c}]`).join(", ")});`,
  );

  return [create, ...indexDdl, ...fkDdl].join("\n\n");
}

// ─── Modules (procs/functions) + execution plan (Phase C) ────────────────

export interface SqlServerParam {
  name: string;
  type: string;
  isOutput: boolean;
  hasDefault: boolean;
}

export interface SqlServerModule {
  schema: string;
  name: string;
  kind: string;
  definition: string | null;
  params: SqlServerParam[];
}

export async function getSqlServerModule(
  config: SqlServerConfig,
  database: string,
  schema: string,
  name: string,
): Promise<SqlServerModule> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(name, "object name");
  return withPool(
    config,
    async (pool) => {
      const objId = `OBJECT_ID('${schema}.${name}')`;
      const [defR, parR, kindR] = await Promise.all([
        pool.request().query<{ definition: string | null }>(
          `SELECT OBJECT_DEFINITION(${objId}) AS definition`,
        ),
        pool.request().query<{
          name: string;
          type_name: string;
          is_output: boolean;
          has_default_value: boolean;
        }>(`
          SELECT p.name, TYPE_NAME(p.user_type_id) AS type_name,
                 p.is_output, p.has_default_value
          FROM sys.parameters p
          WHERE p.object_id = ${objId}
          ORDER BY p.parameter_id
        `),
        pool.request().query<{ type: string }>(
          `SELECT RTRIM(type) AS type FROM sys.objects WHERE object_id = ${objId}`,
        ),
      ]);
      const typeCode = kindR.recordset[0]?.type ?? "P";
      const kind =
        typeCode === "P" ? "proc"
        : typeCode === "FN" ? "scalar_fn"
        : typeCode === "IF" || typeCode === "TF" ? "table_fn"
        : typeCode === "TR" ? "trigger"
        : typeCode === "V" ? "view"
        : typeCode;
      return {
        schema,
        name,
        kind,
        definition: defR.recordset[0]?.definition ?? null,
        params: parR.recordset.map((p) => ({
          name: String(p.name),
          type: String(p.type_name),
          isOutput: Boolean(p.is_output),
          hasDefault: Boolean(p.has_default_value),
        })),
      };
    },
    { database },
  );
}

export interface PlanNode {
  physicalOp: string;
  logicalOp: string;
  /** Estimated cumulative subtree cost. */
  subtreeCost: number;
  estimateRows: number;
  /** Object touched (table/index), best-effort. */
  object: string | null;
  /** Percentage of total plan cost this node alone contributes. */
  costPct: number;
  children: PlanNode[];
}

export interface MissingIndex {
  impact: number;
  statement: string;
  createStatement: string;
}

export interface SqlServerPlan {
  root: PlanNode | null;
  totalCost: number;
  missingIndexes: MissingIndex[];
  rawXml: string;
}

interface RawRelOp {
  PhysicalOp?: string;
  LogicalOp?: string;
  EstimatedTotalSubtreeCost?: string | number;
  EstimateRows?: string | number;
  RelOp?: RawRelOp | RawRelOp[];
  [k: string]: unknown;
}

/** Get the estimated query plan via SHOWPLAN_XML (no execution) and parse it. */
export async function getSqlServerEstimatedPlan(
  config: SqlServerConfig,
  database: string | undefined,
  query: string,
): Promise<SqlServerPlan> {
  const { XMLParser } = await import("fast-xml-parser");
  const db = database && SQLSERVER_DB_NAME_RE.test(database) ? database : undefined;
  return withPool(
    config,
    async (pool) => {
      // SHOWPLAN_XML must be its own batch; the plan comes back as a single
      // XML column from the *next* batch.
      await pool.request().batch("SET SHOWPLAN_XML ON");
      const res = await pool.request().batch(query);
      await pool.request().batch("SET SHOWPLAN_XML OFF").catch(() => undefined);
      const row = (res.recordset?.[0] ?? {}) as Record<string, unknown>;
      const xml = String(Object.values(row)[0] ?? "");
      if (!xml) {
        return { root: null, totalCost: 0, missingIndexes: [], rawXml: "" };
      }

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        isArray: (name) => name === "RelOp" || name === "MissingIndexGroup" || name === "MissingIndex" || name === "Column",
      });
      const parsed = parser.parse(xml) as Record<string, unknown>;

      // Drill to the first statement's QueryPlan.RelOp.
      const findFirst = (obj: unknown, key: string): unknown => {
        if (!obj || typeof obj !== "object") return undefined;
        const rec = obj as Record<string, unknown>;
        if (key in rec) return rec[key];
        for (const v of Object.values(rec)) {
          const found = findFirst(v, key);
          if (found !== undefined) return found;
        }
        return undefined;
      };

      const queryPlan = findFirst(parsed, "QueryPlan") as Record<string, unknown> | undefined;
      const rootRaw = queryPlan
        ? ((Array.isArray(queryPlan.RelOp) ? queryPlan.RelOp[0] : queryPlan.RelOp) as RawRelOp | undefined)
        : undefined;

      const totalCost = rootRaw ? Number(rootRaw.EstimatedTotalSubtreeCost ?? 0) : 0;

      const convert = (raw: RawRelOp): PlanNode => {
        const children = raw.RelOp
          ? (Array.isArray(raw.RelOp) ? raw.RelOp : [raw.RelOp]).map(convert)
          : [];
        const subtreeCost = Number(raw.EstimatedTotalSubtreeCost ?? 0);
        const childCost = children.reduce((s, c) => s + c.subtreeCost, 0);
        const ownCost = Math.max(0, subtreeCost - childCost);
        // best-effort object name from any nested Object node
        const objNode = findFirst(raw, "Object") as Record<string, unknown> | Record<string, unknown>[] | undefined;
        const first = Array.isArray(objNode) ? objNode[0] : objNode;
        const object = first
          ? [first.Schema, first.Table, first.Index].filter(Boolean).map(String).join(".") || null
          : null;
        return {
          physicalOp: String(raw.PhysicalOp ?? "?"),
          logicalOp: String(raw.LogicalOp ?? ""),
          subtreeCost,
          estimateRows: Number(raw.EstimateRows ?? 0),
          object,
          costPct: totalCost > 0 ? (ownCost / totalCost) * 100 : 0,
          children,
        };
      };

      const root = rootRaw ? convert(rootRaw) : null;

      // Missing indexes.
      const missingIndexes: MissingIndex[] = [];
      const miGroup = findFirst(parsed, "MissingIndexes") as Record<string, unknown> | undefined;
      if (miGroup) {
        const groups = miGroup.MissingIndexGroup;
        const arr = Array.isArray(groups) ? groups : groups ? [groups] : [];
        for (const g of arr as Record<string, unknown>[]) {
          const impact = Number(g.Impact ?? 0);
          const mi = Array.isArray(g.MissingIndex) ? g.MissingIndex[0] : g.MissingIndex;
          if (!mi) continue;
          const m = mi as Record<string, unknown>;
          const schema = String(m.Schema ?? "").replace(/[[\]]/g, "");
          const table = String(m.Table ?? "").replace(/[[\]]/g, "");
          // Build a CREATE INDEX from the ColumnGroups (Usage EQUALITY/INEQUALITY/INCLUDE).
          const cgs = Array.isArray(m.ColumnGroup) ? m.ColumnGroup : m.ColumnGroup ? [m.ColumnGroup] : [];
          const key: string[] = [];
          const include: string[] = [];
          for (const cg of cgs as Record<string, unknown>[]) {
            const usage = String(cg.Usage ?? "");
            const cols = Array.isArray(cg.Column) ? cg.Column : cg.Column ? [cg.Column] : [];
            for (const c of cols as Record<string, unknown>[]) {
              const name = String(c.Name ?? "").replace(/[[\]]/g, "");
              if (usage === "INCLUDE") include.push(name);
              else key.push(name);
            }
          }
          const createStatement = `CREATE NONCLUSTERED INDEX [IX_${table}_missing] ON [${schema}].[${table}] (${key
            .map((c) => `[${c}]`)
            .join(", ")})${include.length ? ` INCLUDE (${include.map((c) => `[${c}]`).join(", ")})` : ""};`;
          missingIndexes.push({
            impact,
            statement: `${schema}.${table}`,
            createStatement,
          });
        }
      }

      return { root, totalCost, missingIndexes, rawXml: xml };
    },
    { database: db, requestTimeoutMs: 30_000 },
  );
}

export interface ExpensiveQuery {
  text: string;
  executionCount: number;
  totalWorkerTimeMs: number;
  avgWorkerTimeMs: number;
  totalLogicalReads: number;
  avgLogicalReads: number;
  lastExecution: string | null;
}

/** Top queries by total CPU from the plan cache (the "what did my ORM do" view). */
export async function getSqlServerExpensiveQueries(
  config: SqlServerConfig,
): Promise<ExpensiveQuery[]> {
  return withPool(config, async (pool) => {
    const res = await pool.request().query<{
      text: string | null;
      execution_count: number;
      total_worker_time: number;
      total_logical_reads: number;
      last_execution_time: Date | null;
    }>(`
      SELECT TOP 50
        SUBSTRING(t.text, (qs.statement_start_offset/2)+1,
          ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(t.text)
            ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) AS text,
        qs.execution_count,
        qs.total_worker_time,
        qs.total_logical_reads,
        qs.last_execution_time
      FROM sys.dm_exec_query_stats qs
      CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
      ORDER BY qs.total_worker_time DESC
    `);
    return res.recordset.map((r) => {
      const count = Number(r.execution_count) || 1;
      const workerUs = Number(r.total_worker_time ?? 0); // microseconds
      const reads = Number(r.total_logical_reads ?? 0);
      return {
        text: (r.text ?? "").trim(),
        executionCount: count,
        totalWorkerTimeMs: workerUs / 1000,
        avgWorkerTimeMs: workerUs / 1000 / count,
        totalLogicalReads: reads,
        avgLogicalReads: reads / count,
        lastExecution: r.last_execution_time
          ? new Date(r.last_execution_time).toISOString()
          : null,
      };
    });
  });
}

// ─── Locks / blocking (Phase D) ──────────────────────────────────────────

export interface SqlServerBlockNode {
  sessionId: number;
  loginName: string | null;
  hostName: string | null;
  databaseName: string | null;
  status: string | null;
  waitType: string | null;
  command: string | null;
  text: string | null;
  blockingSessionId: number | null;
}

/** Sessions that are either blocking or blocked, for the blocking-graph tree. */
export async function listSqlServerBlocking(
  config: SqlServerConfig,
): Promise<SqlServerBlockNode[]> {
  return withPool(config, async (pool) => {
    const res = await pool.request().query<{
      session_id: number;
      login_name: string | null;
      host_name: string | null;
      database_name: string | null;
      status: string | null;
      wait_type: string | null;
      command: string | null;
      sql_text: string | null;
      blocking_session_id: number | null;
    }>(`
      WITH involved AS (
        SELECT r.session_id, r.blocking_session_id
        FROM sys.dm_exec_requests r
        WHERE r.blocking_session_id <> 0
        UNION
        SELECT r.blocking_session_id, 0
        FROM sys.dm_exec_requests r
        WHERE r.blocking_session_id <> 0
      )
      SELECT DISTINCT
        s.session_id,
        s.login_name,
        s.host_name,
        DB_NAME(COALESCE(r.database_id, s.database_id)) AS database_name,
        COALESCE(r.status, s.status) AS status,
        r.wait_type,
        r.command,
        t.text AS sql_text,
        NULLIF(r.blocking_session_id, 0) AS blocking_session_id
      FROM involved iv
      JOIN sys.dm_exec_sessions s ON s.session_id = iv.session_id
      LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
      OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
    `);
    return res.recordset.map((row) => ({
      sessionId: Number(row.session_id),
      loginName: row.login_name ?? null,
      hostName: row.host_name ?? null,
      databaseName: row.database_name ?? null,
      status: row.status ?? null,
      waitType: row.wait_type ?? null,
      command: row.command ?? null,
      text: row.sql_text ?? null,
      blockingSessionId:
        row.blocking_session_id != null ? Number(row.blocking_session_id) : null,
    }));
  });
}

// ─── Overview extras (signals for the home dashboard) ────────────────────

export interface SqlServerBlockerChain {
  blockedSpid: number;
  blockedFor: number; // seconds
  blockedQuery: string | null;
  blockedBy: number[];
}

export interface SqlServerWaitBucket {
  /** Coarse classification (see classifyWait). */
  bucket: string;
  /** Aggregate wait time in seconds since last clear of sys.dm_os_wait_stats. */
  waitSeconds: number;
}

export interface SqlServerOverviewExtras {
  blockerCount: number;
  blockerChains: SqlServerBlockerChain[];
  /** Seconds since the longest-running idle-in-txn session opened its txn. */
  oldestIdleInTxnSec: number | null;
  /** Seconds the longest currently-running query has been executing. */
  longestActiveQuerySec: number | null;
  /** Top wait classes by cumulative wait time since boot/last clear. */
  topWaits: SqlServerWaitBucket[];
}

/**
 * Cheap dashboard signals — single round-trip per source DMV, no per-database
 * fan-out. Pairs with getSqlServerOverview to feed the home page KPI strip,
 * health badges, and (conditionally) the blockers panel. Failures from any
 * one section are caught so a missing permission doesn't blank the page.
 */
export async function getSqlServerOverviewExtras(
  config: SqlServerConfig,
): Promise<SqlServerOverviewExtras> {
  return withPool(config, async (pool) => {
    // 1) Blockers — collapsed to one row per blocked session.
    let blockerCount = 0;
    const blockerChains: SqlServerBlockerChain[] = [];
    try {
      const res = await pool.request().query<{
        session_id: number;
        wait_time_ms: number | null;
        wait_type: string | null;
        sql_text: string | null;
        blocking_session_id: number | null;
      }>(`
        SELECT
          r.session_id,
          r.wait_time AS wait_time_ms,
          r.wait_type,
          SUBSTRING(t.text, (r.statement_start_offset/2)+1,
            ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text)
              ELSE r.statement_end_offset END - r.statement_start_offset)/2)+1) AS sql_text,
          r.blocking_session_id
        FROM sys.dm_exec_requests r
        OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
        WHERE r.blocking_session_id <> 0
      `);
      blockerCount = res.recordset.length;
      for (const r of res.recordset) {
        blockerChains.push({
          blockedSpid: Number(r.session_id),
          blockedFor: Number(r.wait_time_ms ?? 0) / 1000,
          blockedQuery: (r.sql_text ?? "").trim() || null,
          blockedBy: r.blocking_session_id != null ? [Number(r.blocking_session_id)] : [],
        });
      }
    } catch {
      // Permissions / DMV unavailable — skip the section.
    }

    // 2) Oldest idle-in-txn — sleeping sessions with an open transaction
    //    that haven't issued a request in a while.
    let oldestIdleInTxnSec: number | null = null;
    try {
      const res = await pool.request().query<{ secs: number | null }>(`
        SELECT TOP 1
          DATEDIFF(SECOND, s.last_request_end_time, GETDATE()) AS secs
        FROM sys.dm_exec_sessions s
        WHERE s.is_user_process = 1
          AND s.status = 'sleeping'
          AND s.open_transaction_count > 0
        ORDER BY s.last_request_end_time ASC
      `);
      const v = res.recordset[0]?.secs;
      oldestIdleInTxnSec = v != null ? Number(v) : null;
    } catch {
      // ignore
    }

    // 3) Longest currently-running query.
    let longestActiveQuerySec: number | null = null;
    try {
      const res = await pool.request().query<{ secs: number | null }>(`
        SELECT TOP 1 r.total_elapsed_time / 1000 AS secs
        FROM sys.dm_exec_requests r
        JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
        WHERE s.is_user_process = 1
          AND r.session_id <> @@SPID
        ORDER BY r.total_elapsed_time DESC
      `);
      const v = res.recordset[0]?.secs;
      longestActiveQuerySec = v != null ? Number(v) : null;
    } catch {
      // ignore
    }

    // 4) Top wait classes since last DBCC SQLPERF clear. Bucketed by
    //    classifyWait so the UI shows "IO 42m, Lock 18m, Latch 9m, ..."
    //    instead of cryptic raw wait_type names.
    const topWaits: SqlServerWaitBucket[] = [];
    try {
      const res = await pool.request().query<{
        wait_type: string;
        wait_ms: number | string;
      }>(`
        SELECT wait_type, wait_time_ms AS wait_ms
        FROM sys.dm_os_wait_stats
        WHERE wait_type NOT IN (
          -- Common idle/benign waits filtered per Paul Randal's guidance.
          'BROKER_EVENTHANDLER','BROKER_RECEIVE_WAITFOR','BROKER_TASK_STOP',
          'BROKER_TO_FLUSH','BROKER_TRANSMITTER','CHECKPOINT_QUEUE',
          'CLR_AUTO_EVENT','CLR_MANUAL_EVENT','CLR_SEMAPHORE','DBMIRROR_DBM_EVENT',
          'DBMIRROR_EVENTS_QUEUE','DBMIRROR_WORKER_QUEUE','DIRTY_PAGE_POLL',
          'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT',
          'FT_IFTSHC_MUTEX','HADR_CLUSAPI_CALL','HADR_FILESTREAM_IOMGR_IOCOMPLETION',
          'HADR_LOGCAPTURE_WAIT','HADR_NOTIFICATION_DEQUEUE','HADR_TIMER_TASK',
          'HADR_WORK_QUEUE','KSOURCE_WAKEUP','LAZYWRITER_SLEEP','LOGMGR_QUEUE',
          'ONDEMAND_TASK_QUEUE','PWAIT_ALL_COMPONENTS_INITIALIZED','QDS_PERSIST_TASK_MAIN_LOOP_SLEEP',
          'QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP','REQUEST_FOR_DEADLOCK_SEARCH',
          'SLEEP_BPOOL_FLUSH','SLEEP_DBSTARTUP','SLEEP_DCOMSTARTUP','SLEEP_MASTERDBREADY',
          'SLEEP_MASTERMDREADY','SLEEP_MASTERUPGRADED','SLEEP_MSDBSTARTUP','SLEEP_SYSTEMTASK',
          'SLEEP_TASK','SLEEP_TEMPDBSTARTUP','SNI_HTTP_ACCEPT','SP_SERVER_DIAGNOSTICS_SLEEP',
          'SQLTRACE_BUFFER_FLUSH','SQLTRACE_INCREMENTAL_FLUSH_SLEEP','SQLTRACE_WAIT_ENTRIES',
          'WAIT_FOR_RESULTS','WAITFOR','WAITFOR_TASKSHUTDOWN','WAIT_XTP_RECOVERY',
          'WAIT_XTP_HOST_WAIT','WAIT_XTP_OFFLINE_CKPT_NEW_LOG','WAIT_XTP_CKPT_CLOSE',
          'XE_DISPATCHER_JOIN','XE_DISPATCHER_WAIT','XE_TIMER_EVENT'
        )
        AND wait_time_ms > 0
      `);
      const bucketed = new Map<string, number>();
      for (const r of res.recordset) {
        const bucket = classifyWait(r.wait_type);
        bucketed.set(bucket, (bucketed.get(bucket) ?? 0) + Number(r.wait_ms ?? 0));
      }
      for (const [bucket, ms] of bucketed) {
        topWaits.push({ bucket, waitSeconds: ms / 1000 });
      }
      topWaits.sort((a, b) => b.waitSeconds - a.waitSeconds);
    } catch {
      // ignore
    }

    return {
      blockerCount,
      blockerChains,
      oldestIdleInTxnSec,
      longestActiveQuerySec,
      topWaits: topWaits.slice(0, 6),
    };
  });
}

// ─── Query Store (Phase D) ───────────────────────────────────────────────

export interface QueryStoreStatus {
  enabled: boolean;
  state: string | null;
}

export interface QueryStoreQuery {
  queryId: number;
  planId: number;
  text: string;
  executionCount: number;
  avgDurationMs: number;
  avgCpuMs: number;
  avgLogicalReads: number;
  isForced: boolean;
}

export async function getQueryStore(
  config: SqlServerConfig,
  database: string,
): Promise<{ status: QueryStoreStatus; top: QueryStoreQuery[] }> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      const statusR = await pool
        .request()
        .query<{ actual_state_desc: string | null }>(
          `SELECT actual_state_desc FROM sys.database_query_store_options`,
        )
        .catch(() => null);
      const state = statusR?.recordset[0]?.actual_state_desc ?? null;
      const enabled = !!state && state !== "OFF";
      if (!enabled) {
        return { status: { enabled, state }, top: [] };
      }

      const topR = await pool.request().query<{
        query_id: number;
        plan_id: number;
        query_sql_text: string | null;
        count_executions: string | number;
        avg_duration: number;
        avg_cpu_time: number;
        avg_logical_io_reads: number;
        is_forced_plan: boolean;
      }>(`
        SELECT TOP 50
          q.query_id, p.plan_id, qt.query_sql_text,
          SUM(rs.count_executions) AS count_executions,
          AVG(rs.avg_duration) AS avg_duration,
          AVG(rs.avg_cpu_time) AS avg_cpu_time,
          AVG(rs.avg_logical_io_reads) AS avg_logical_io_reads,
          MAX(CAST(p.is_forced_plan AS INT)) AS is_forced_plan
        FROM sys.query_store_runtime_stats rs
        JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
        JOIN sys.query_store_query q ON q.query_id = p.query_id
        JOIN sys.query_store_query_text qt ON qt.query_text_id = q.query_text_id
        GROUP BY q.query_id, p.plan_id, qt.query_sql_text
        ORDER BY AVG(rs.avg_cpu_time) DESC
      `);

      return {
        status: { enabled, state },
        top: topR.recordset.map((r) => ({
          queryId: Number(r.query_id),
          planId: Number(r.plan_id),
          text: (r.query_sql_text ?? "").trim(),
          executionCount: Number(r.count_executions ?? 0),
          // Query Store stores durations in microseconds.
          avgDurationMs: Number(r.avg_duration ?? 0) / 1000,
          avgCpuMs: Number(r.avg_cpu_time ?? 0) / 1000,
          avgLogicalReads: Number(r.avg_logical_io_reads ?? 0),
          isForced: Boolean(r.is_forced_plan),
        })),
      };
    },
    { database },
  );
}

export async function setQueryStorePlanForced(
  config: SqlServerConfig,
  database: string,
  queryId: number,
  planId: number,
  forced: boolean,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  if (!Number.isInteger(queryId) || !Number.isInteger(planId)) {
    throw new Error("Invalid query/plan id");
  }
  await withPool(
    config,
    async (pool) => {
      const proc = forced ? "sp_query_store_force_plan" : "sp_query_store_unforce_plan";
      await pool.request().batch(`EXEC ${proc} @query_id = ${queryId}, @plan_id = ${planId}`);
    },
    { database },
  );
}

// ─── Index maintenance (Phase D) ─────────────────────────────────────────

export interface IndexFragmentation {
  schema: string;
  table: string;
  index: string;
  indexType: string;
  fragmentationPct: number;
  pageCount: number;
  recommendation: "none" | "reorganize" | "rebuild";
}

export async function getSqlServerIndexFragmentation(
  config: SqlServerConfig,
  database: string,
): Promise<IndexFragmentation[]> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      // LIMITED mode only — DETAILED scans every page and would hammer prod.
      const res = await pool.request().query<{
        schema_name: string;
        table_name: string;
        index_name: string | null;
        index_type: string;
        frag: number;
        page_count: string | number;
      }>(`
        SELECT
          s.name AS schema_name, t.name AS table_name,
          i.name AS index_name, i.type_desc AS index_type,
          ips.avg_fragmentation_in_percent AS frag,
          ips.page_count
        FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
        JOIN sys.tables t ON t.object_id = ips.object_id
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        JOIN sys.indexes i ON i.object_id = ips.object_id AND i.index_id = ips.index_id
        WHERE ips.index_id > 0 AND ips.page_count >= 100
        ORDER BY ips.avg_fragmentation_in_percent DESC
      `);
      return res.recordset
        .filter((r) => r.index_name)
        .map((r) => {
          const frag = Number(r.frag ?? 0);
          const rec: IndexFragmentation["recommendation"] =
            frag > 30 ? "rebuild" : frag > 5 ? "reorganize" : "none";
          return {
            schema: String(r.schema_name),
            table: String(r.table_name),
            index: String(r.index_name),
            indexType: String(r.index_type),
            fragmentationPct: frag,
            pageCount: Number(r.page_count ?? 0),
            recommendation: rec,
          };
        });
    },
    { database },
  );
}

export async function maintainSqlServerIndex(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  index: string,
  action: "rebuild" | "reorganize",
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(table, "table name");
  validateSqlServerIdentifier(index, "index name");
  await withPool(
    config,
    async (pool) => {
      const verb = action === "rebuild" ? "REBUILD" : "REORGANIZE";
      await pool.request().batch(`ALTER INDEX [${index}] ON [${schema}].[${table}] ${verb}`);
    },
    { database, requestTimeoutMs: 120_000 },
  );
}

export interface SqlServerMissingIndex {
  schema: string;
  table: string;
  impact: number;
  userSeeks: number;
  createStatement: string;
}

export async function getSqlServerMissingIndexes(
  config: SqlServerConfig,
  database: string,
): Promise<SqlServerMissingIndex[]> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      const res = await pool.request().query<{
        schema_name: string;
        table_name: string;
        avg_user_impact: number;
        user_seeks: number;
        equality_columns: string | null;
        inequality_columns: string | null;
        included_columns: string | null;
      }>(`
        SELECT
          s.name AS schema_name, t.name AS table_name,
          gs.avg_user_impact, gs.user_seeks,
          id.equality_columns, id.inequality_columns, id.included_columns
        FROM sys.dm_db_missing_index_group_stats gs
        JOIN sys.dm_db_missing_index_groups g ON g.index_group_handle = gs.group_handle
        JOIN sys.dm_db_missing_index_details id ON id.index_handle = g.index_handle
        JOIN sys.tables t ON t.object_id = id.object_id
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE id.database_id = DB_ID()
        ORDER BY gs.avg_user_impact * (gs.user_seeks + gs.user_scans) DESC
      `);
      return res.recordset.map((r) => {
        const eq = (r.equality_columns ?? "").replace(/[[\]]/g, "");
        const ineq = (r.inequality_columns ?? "").replace(/[[\]]/g, "");
        const incl = (r.included_columns ?? "").replace(/[[\]]/g, "");
        const keyCols = [eq, ineq].filter(Boolean).join(", ");
        const inclClause = incl ? ` INCLUDE (${incl})` : "";
        return {
          schema: String(r.schema_name),
          table: String(r.table_name),
          impact: Number(r.avg_user_impact ?? 0),
          userSeeks: Number(r.user_seeks ?? 0),
          createStatement: `CREATE NONCLUSTERED INDEX [IX_${r.table_name}_suggested] ON [${r.schema_name}].[${r.table_name}] (${keyCols})${inclClause};`,
        };
      });
    },
    { database },
  );
}

// ─── Backup / restore (Phase E) ──────────────────────────────────────────

export interface BackupHistoryRow {
  type: string; // Full / Differential / Log
  startTime: string | null;
  finishTime: string | null;
  sizeBytes: number;
  device: string | null;
}

export async function getSqlServerBackupHistory(
  config: SqlServerConfig,
  database: string,
): Promise<BackupHistoryRow[]> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(config, async (pool) => {
    const res = await pool
      .request()
      .input("db", ((await getMssql()).default as unknown as { NVarChar: unknown }).NVarChar, database)
      .query<{
        type: string;
        backup_start_date: Date | null;
        backup_finish_date: Date | null;
        backup_size: string | number | null;
        physical_device_name: string | null;
      }>(`
        SELECT TOP 50
          CASE bs.type WHEN 'D' THEN 'Full' WHEN 'I' THEN 'Differential'
               WHEN 'L' THEN 'Log' ELSE bs.type END AS type,
          bs.backup_start_date, bs.backup_finish_date, bs.backup_size,
          bmf.physical_device_name
        FROM msdb.dbo.backupset bs
        LEFT JOIN msdb.dbo.backupmediafamily bmf ON bmf.media_set_id = bs.media_set_id
        WHERE bs.database_name = @db
        ORDER BY bs.backup_start_date DESC
      `);
    return res.recordset.map((r) => ({
      type: String(r.type),
      startTime: r.backup_start_date ? new Date(r.backup_start_date).toISOString() : null,
      finishTime: r.backup_finish_date ? new Date(r.backup_finish_date).toISOString() : null,
      sizeBytes: Number(r.backup_size ?? 0),
      device: r.physical_device_name ?? null,
    }));
  });
}

/**
 * Native BACKUP DATABASE to a server-side path (the SQL Server service
 * account writes it, NOT the Baklava host). Path is validated to a
 * conservative charset since it's spliced into the statement.
 */
export async function backupSqlServerDatabase(
  config: SqlServerConfig,
  database: string,
  path: string,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  // Allow typical Windows/Linux path chars; reject quotes/semicolons.
  if (!/^[A-Za-z0-9_\-./\\: ]+$/.test(path) || path.includes("'")) {
    throw new Error("Invalid backup path");
  }
  await withPool(
    config,
    async (pool) => {
      await pool
        .request()
        .batch(
          `BACKUP DATABASE [${database}] TO DISK = N'${path}' WITH COMPRESSION, CHECKSUM, INIT, STATS = 10`,
        );
    },
    { requestTimeoutMs: 600_000 },
  );
}

// ─── Security: logins / users / roles (Phase E) ──────────────────────────

export interface SqlServerLogin {
  name: string;
  type: string;
  isDisabled: boolean;
  serverRoles: string[];
}
export interface SqlServerUser {
  name: string;
  type: string;
  defaultSchema: string | null;
  databaseRoles: string[];
  orphaned: boolean;
}

export async function getSqlServerSecurity(
  config: SqlServerConfig,
  database: string,
): Promise<{ logins: SqlServerLogin[]; users: SqlServerUser[] }> {
  validateSqlServerIdentifier(database, "database name");
  const loginRows = await withPool(config, async (pool) => {
    return pool.request().query<{
      name: string;
      type_desc: string;
      is_disabled: boolean;
      roles: string | null;
    }>(`
      SELECT sp.name, sp.type_desc, CAST(sp.is_disabled AS BIT) AS is_disabled,
        (SELECT STRING_AGG(r.name, ', ')
           FROM sys.server_role_members rm
           JOIN sys.server_principals r ON r.principal_id = rm.role_principal_id
           WHERE rm.member_principal_id = sp.principal_id) AS roles
      FROM sys.server_principals sp
      WHERE sp.type IN ('S','U','G') AND sp.name NOT LIKE '##%'
      ORDER BY sp.name
    `);
  });

  const userRows = await withPool(
    config,
    async (pool) => {
      return pool.request().query<{
        name: string;
        type_desc: string;
        default_schema_name: string | null;
        roles: string | null;
        orphaned: number;
      }>(`
        SELECT dp.name, dp.type_desc, dp.default_schema_name,
          (SELECT STRING_AGG(r.name, ', ')
             FROM sys.database_role_members rm
             JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
             WHERE rm.member_principal_id = dp.principal_id) AS roles,
          CASE WHEN dp.type IN ('S','U') AND dp.sid IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM sys.server_principals sp WHERE sp.sid = dp.sid)
               THEN 1 ELSE 0 END AS orphaned
        FROM sys.database_principals dp
        WHERE dp.type IN ('S','U','G') AND dp.name NOT IN ('guest','INFORMATION_SCHEMA','sys')
        ORDER BY dp.name
      `);
    },
    { database },
  );

  return {
    logins: loginRows.recordset.map((r) => ({
      name: String(r.name),
      type: String(r.type_desc),
      isDisabled: Boolean(r.is_disabled),
      serverRoles: r.roles ? String(r.roles).split(", ") : [],
    })),
    users: userRows.recordset.map((r) => ({
      name: String(r.name),
      type: String(r.type_desc),
      defaultSchema: r.default_schema_name ?? null,
      databaseRoles: r.roles ? String(r.roles).split(", ") : [],
      orphaned: Number(r.orphaned) === 1,
    })),
  };
}

// ─── Dependencies (Phase E) ──────────────────────────────────────────────

export interface SqlServerDependency {
  schema: string | null;
  name: string;
  type: string | null;
}

export async function getSqlServerDependencies(
  config: SqlServerConfig,
  database: string,
  schema: string,
  object: string,
): Promise<{ referencing: SqlServerDependency[]; referenced: SqlServerDependency[] }> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(object, "object name");
  return withPool(
    config,
    async (pool) => {
      const target = `'${schema}.${object}'`;
      const refrR = await pool
        .request()
        .query<{ schema_name: string | null; name: string; type: string | null }>(`
          SELECT referencing_schema_name AS schema_name, referencing_entity_name AS name,
                 o.type_desc AS type
          FROM sys.dm_sql_referencing_entities(${target}, 'OBJECT') re
          LEFT JOIN sys.objects o ON o.object_id = re.referencing_id
        `)
        .catch(() => null);
      const refdR = await pool
        .request()
        .query<{ schema_name: string | null; name: string | null; type: string | null }>(`
          SELECT referenced_schema_name AS schema_name, referenced_entity_name AS name, NULL AS type
          FROM sys.dm_sql_referenced_entities(${target}, 'OBJECT')
        `)
        .catch(() => null);
      const map = (
        rows: Array<{ schema_name: string | null; name: string | null; type?: string | null }> | undefined,
      ): SqlServerDependency[] =>
        (rows ?? [])
          .filter((r) => r.name)
          .map((r) => ({
            schema: r.schema_name ?? null,
            name: String(r.name),
            type: r.type ?? null,
          }));
      // De-dup referenced entities (one row per column otherwise).
      const refdSeen = new Set<string>();
      const referenced = map(refdR?.recordset).filter((d) => {
        const k = `${d.schema}.${d.name}`;
        if (refdSeen.has(k)) return false;
        refdSeen.add(k);
        return true;
      });
      return { referencing: map(refrR?.recordset), referenced };
    },
    { database },
  );
}
