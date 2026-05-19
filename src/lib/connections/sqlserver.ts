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
  fn: (pool: ConnectionPool) => Promise<T>,
  opts?: { database?: string; requestTimeoutMs?: number }
): Promise<T> {
  const pool = await sql.connect({
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

    const databases = await fetchDatabaseStats(pool);

    return {
      version: String(head.version).split("\n")[0]?.trim() || "unknown",
      productVersion: head.product_version ?? null,
      edition: head.edition ?? null,
      serverName: head.server_name ?? null,
      currentUser: head.login_name ?? null,
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
  /** table | view | proc | scalar_fn | table_fn | trigger | synonym */
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
          AND o.type IN ('U','V','P','FN','IF','TF','TR','SN')
        UNION ALL
        SELECT s.name AS schema_name, sy.name AS name, 'SN' AS type
        FROM sys.synonyms sy
        JOIN sys.schemas s ON s.schema_id = sy.schema_id
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
      const fqn = `[${schema}].[${table}]`;
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
