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
