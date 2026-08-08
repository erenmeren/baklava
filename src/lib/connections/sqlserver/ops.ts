/**
 * SQL Server driver — server overview, activity/sessions, expensive queries,
 * blocking, dashboard extras, Query Store, index maintenance, security.
 */
import type { SqlServerConfig } from "../types";
import { withPool, fetchDatabaseStats } from "./internal";
import { validateSqlServerIdentifier } from "./sql";
import type { SqlServerDatabaseSummary } from "./catalog";

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

// ─── Locks / blocking ─────────────────────────────────────────────────────

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

// ─── Query Store ──────────────────────────────────────────────────────────

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

// ─── Index maintenance ────────────────────────────────────────────────────

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

// ─── Security: logins / users / roles ─────────────────────────────────────

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
