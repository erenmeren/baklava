/**
 * Postgres driver — server-level operations: overview, activity, locks,
 * maintenance (VACUUM/ANALYZE/REINDEX), diagnostics, roles.
 */
import type { PostgresConfig } from "../types";
import { withClient } from "./client";
import { quoteIdent, validateIdentifier } from "./sql";
import { tableIdent } from "./internal";

export interface ServerOverview {
  serverVersion: string;
  currentUser: string;
  currentDatabase: string;
  uptimeSeconds: number;
  maxConnections: number;
  activeConnections: number;
  idleConnections: number;
  cacheHitRatio: number; // 0..1; null source rows treated as 0
  totalDatabasesSize: number;
  databases: Array<{
    name: string;
    owner: string;
    encoding: string;
    size: number;
    connections: number;
  }>;
}

export async function getServerOverview(
  config: PostgresConfig,
): Promise<ServerOverview> {
  return withClient(config, undefined, async (client) => {
    const [head, dbs, hit] = await Promise.all([
      client.query<{
        version: string;
        current_user: string;
        current_database: string;
        uptime: string;
        max_connections: string;
        active: string;
        idle: string;
      }>(
        `select
           version() as version,
           current_user as current_user,
           current_database() as current_database,
           extract(epoch from (now() - pg_postmaster_start_time()))::bigint::text as uptime,
           current_setting('max_connections') as max_connections,
           (select count(*) filter (where state = 'active') from pg_stat_activity)::text as active,
           (select count(*) filter (where state = 'idle') from pg_stat_activity)::text as idle`,
      ),
      client.query<{
        name: string;
        owner: string;
        encoding: string;
        size: string;
        connections: string;
      }>(
        `select d.datname as name,
                pg_get_userbyid(d.datdba) as owner,
                pg_encoding_to_char(d.encoding) as encoding,
                pg_database_size(d.datname)::text as size,
                coalesce((
                  select count(*)
                  from pg_stat_activity a
                  where a.datname = d.datname
                ), 0)::text as connections
         from pg_database d
         where d.datistemplate = false
         order by pg_database_size(d.datname) desc`,
      ),
      client.query<{ hit: string | null }>(
        `select
           case
             when sum(blks_hit + blks_read) = 0 then null
             else sum(blks_hit)::float / sum(blks_hit + blks_read)
           end::text as hit
         from pg_stat_database`,
      ),
    ]);

    const h = head.rows[0];
    const databases = dbs.rows.map((r) => ({
      name: r.name,
      owner: r.owner,
      encoding: r.encoding,
      size: Number(r.size),
      connections: Number(r.connections),
    }));
    return {
      serverVersion: h.version,
      currentUser: h.current_user,
      currentDatabase: h.current_database,
      uptimeSeconds: Number(h.uptime),
      maxConnections: Number(h.max_connections),
      activeConnections: Number(h.active),
      idleConnections: Number(h.idle),
      cacheHitRatio: hit.rows[0]?.hit ? Number(hit.rows[0].hit) : 0,
      totalDatabasesSize: databases.reduce((s, d) => s + d.size, 0),
      databases,
    };
  });
}

export interface TopTable {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view";
  rowEstimate: number;
  totalSize: number;
  indexSize: number;
}

export async function getTopTables(
  config: PostgresConfig,
  database: string,
  limit: number = 10,
): Promise<TopTable[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      schema: string;
      name: string;
      kind: string;
      row_estimate: string;
      total_size: string;
      index_size: string;
    }>(
      `select n.nspname as schema,
              c.relname as name,
              case c.relkind
                when 'r' then 'table'
                when 'v' then 'view'
                when 'm' then 'materialized_view'
                else c.relkind::text
              end as kind,
              c.reltuples::bigint::text as row_estimate,
              pg_total_relation_size(c.oid)::text as total_size,
              pg_indexes_size(c.oid)::text as index_size
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'm')
         and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
         and n.nspname not like 'pg_temp_%'
         and n.nspname not like 'pg_toast_temp_%'
       order by pg_total_relation_size(c.oid) desc
       limit $1`,
      [limit],
    );
    return res.rows.map((r) => ({
      schema: r.schema,
      name: r.name,
      kind: r.kind as TopTable["kind"],
      rowEstimate: Number(r.row_estimate),
      totalSize: Number(r.total_size),
      indexSize: Number(r.index_size),
    }));
  });
}

/**
 * Top tables ACROSS every non-template database on the server.
 *
 * Each Postgres connection is scoped to a single database, so this opens
 * one short-lived client per DB in parallel, asks for that DB's top N
 * tables, then merges + sorts globally. Capped to `limit` rows total.
 *
 * A per-DB connection failure (e.g. role can't connect to that DB) is
 * silently skipped — the overview shouldn't fail just because one DB is
 * inaccessible.
 */
export async function getTopTablesAllDatabases(
  config: PostgresConfig,
  limit: number = 10,
): Promise<Array<TopTable & { database: string }>> {
  // First: discover the database list (we want non-template, non-allowconn=false).
  const dbs = await withClient(config, undefined, async (client) => {
    const res = await client.query<{ name: string }>(
      `select datname as name
       from pg_database
       where datistemplate = false
         and datallowconn = true
       order by datname`,
    );
    return res.rows.map((r) => r.name);
  });

  // Fan out: query top-tables in each database in parallel. Per-DB cap is
  // also `limit` to give us a healthy candidate pool before the global sort.
  const perDb = await Promise.all(
    dbs.map(async (db) => {
      try {
        const rows = await getTopTables(config, db, limit);
        return rows.map((r) => ({ ...r, database: db }));
      } catch {
        return [] as Array<TopTable & { database: string }>;
      }
    }),
  );

  const all = perDb.flat();
  all.sort((a, b) => b.totalSize - a.totalSize);
  return all.slice(0, limit);
}

export interface RoleInfo {
  name: string;
  isSuperuser: boolean;
  canLogin: boolean;
  canCreateDb: boolean;
  canCreateRole: boolean;
  canReplication: boolean;
  inherits: boolean;
  connectionLimit: number;
  validUntil: string | null;
  memberOf: string[];
}

export async function listRoles(config: PostgresConfig): Promise<RoleInfo[]> {
  return withClient(config, undefined, async (client) => {
    const res = await client.query<{
      name: string;
      is_superuser: boolean;
      can_login: boolean;
      can_create_db: boolean;
      can_create_role: boolean;
      can_replication: boolean;
      inherits: boolean;
      connection_limit: number;
      valid_until: string | null;
      member_of: string[];
    }>(
      `select r.rolname as name,
              r.rolsuper as is_superuser,
              r.rolcanlogin as can_login,
              r.rolcreatedb as can_create_db,
              r.rolcreaterole as can_create_role,
              r.rolreplication as can_replication,
              r.rolinherit as inherits,
              r.rolconnlimit as connection_limit,
              r.rolvaliduntil::text as valid_until,
              coalesce((
                select array_agg(b.rolname order by b.rolname)
                from pg_auth_members m
                join pg_roles b on b.oid = m.roleid
                where m.member = r.oid
              ), ARRAY[]::name[])::text[] as member_of
       from pg_roles r
       where r.rolname not like 'pg\\_%'
       order by r.rolname`,
    );
    return res.rows.map((r) => ({
      name: r.name,
      isSuperuser: r.is_superuser,
      canLogin: r.can_login,
      canCreateDb: r.can_create_db,
      canCreateRole: r.can_create_role,
      canReplication: r.can_replication,
      inherits: r.inherits,
      connectionLimit: r.connection_limit,
      validUntil: r.valid_until,
      memberOf: Array.isArray(r.member_of) ? r.member_of : [],
    }));
  });
}

export interface RoleAttrs {
  canLogin?: boolean;
  isSuperuser?: boolean;
  canCreateDb?: boolean;
  canCreateRole?: boolean;
  canReplication?: boolean;
  inherits?: boolean;
  connectionLimit?: number;
  password?: string | null; // null clears, undefined leaves alone
}

function attrClauses(attrs: RoleAttrs): string[] {
  const parts: string[] = [];
  if (attrs.canLogin !== undefined) parts.push(attrs.canLogin ? "LOGIN" : "NOLOGIN");
  if (attrs.isSuperuser !== undefined)
    parts.push(attrs.isSuperuser ? "SUPERUSER" : "NOSUPERUSER");
  if (attrs.canCreateDb !== undefined)
    parts.push(attrs.canCreateDb ? "CREATEDB" : "NOCREATEDB");
  if (attrs.canCreateRole !== undefined)
    parts.push(attrs.canCreateRole ? "CREATEROLE" : "NOCREATEROLE");
  if (attrs.canReplication !== undefined)
    parts.push(attrs.canReplication ? "REPLICATION" : "NOREPLICATION");
  if (attrs.inherits !== undefined)
    parts.push(attrs.inherits ? "INHERIT" : "NOINHERIT");
  if (attrs.connectionLimit !== undefined)
    parts.push(`CONNECTION LIMIT ${Math.max(-1, Math.floor(attrs.connectionLimit))}`);
  if (attrs.password !== undefined) {
    if (attrs.password === null || attrs.password === "") {
      parts.push("PASSWORD NULL");
    } else {
      // pg's literal-string escape: double single quotes.
      const escaped = attrs.password.replace(/'/g, "''");
      parts.push(`PASSWORD '${escaped}'`);
    }
  }
  return parts;
}

export async function createRole(
  config: PostgresConfig,
  name: string,
  attrs: RoleAttrs = {},
): Promise<void> {
  const trimmed = validateIdentifier(name, "Role");
  const clauses = attrClauses(attrs);
  const sql =
    clauses.length === 0
      ? `CREATE ROLE ${quoteIdent(trimmed)}`
      : `CREATE ROLE ${quoteIdent(trimmed)} WITH ${clauses.join(" ")}`;
  await withClient(config, undefined, async (client) => {
    await client.query(sql);
  });
}

export async function alterRole(
  config: PostgresConfig,
  name: string,
  attrs: RoleAttrs,
): Promise<void> {
  const clauses = attrClauses(attrs);
  if (clauses.length === 0) throw new Error("No changes to apply");
  const sql = `ALTER ROLE ${quoteIdent(name)} WITH ${clauses.join(" ")}`;
  await withClient(config, undefined, async (client) => {
    await client.query(sql);
  });
}

export async function dropRole(
  config: PostgresConfig,
  name: string,
  options?: { ifExists?: boolean },
): Promise<void> {
  const sql = `DROP ROLE ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(name)}`;
  await withClient(config, undefined, async (client) => {
    await client.query(sql);
  });
}

// ====================================================================
// Server-level operations: activity / locks / maintenance
// ====================================================================

export interface ActivityRow {
  pid: number;
  database: string | null;
  user: string | null;
  applicationName: string | null;
  clientAddr: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  backendStart: string | null;
  xactStart: string | null;
  queryStart: string | null;
  stateChange: string | null;
  backendType: string | null;
  query: string | null;
  /** Seconds since query_start, computed server-side. */
  queryAgeSeconds: number | null;
}

export interface ActivitySnapshot {
  serverPid: number;
  rows: ActivityRow[];
}

export async function listActivity(
  config: PostgresConfig
): Promise<ActivitySnapshot> {
  return withClient(config, undefined, async (client) => {
    const res = await client.query<{
      pid: number;
      datname: string | null;
      usename: string | null;
      application_name: string | null;
      client_addr: string | null;
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
      backend_start: string | null;
      xact_start: string | null;
      query_start: string | null;
      state_change: string | null;
      backend_type: string | null;
      query: string | null;
      query_age: string | null;
    }>(
      `select pid,
              datname,
              usename,
              application_name,
              client_addr::text as client_addr,
              state,
              wait_event_type,
              wait_event,
              backend_start::text as backend_start,
              xact_start::text as xact_start,
              query_start::text as query_start,
              state_change::text as state_change,
              backend_type,
              query,
              extract(epoch from (now() - query_start))::float8::text as query_age
       from pg_stat_activity
       where pid <> pg_backend_pid()
       order by case when state = 'active' then 0 else 1 end,
                xact_start nulls last,
                query_start nulls last`
    );
    const head = await client.query<{ pid: number }>(
      `select pg_backend_pid() as pid`
    );
    return {
      serverPid: head.rows[0]?.pid ?? 0,
      rows: res.rows.map((r) => ({
        pid: r.pid,
        database: r.datname,
        user: r.usename,
        applicationName: r.application_name,
        clientAddr: r.client_addr,
        state: r.state,
        waitEventType: r.wait_event_type,
        waitEvent: r.wait_event,
        backendStart: r.backend_start,
        xactStart: r.xact_start,
        queryStart: r.query_start,
        stateChange: r.state_change,
        backendType: r.backend_type,
        query: r.query,
        queryAgeSeconds:
          r.query_age != null && r.query_age !== ""
            ? Number(r.query_age)
            : null,
      })),
    };
  });
}

export async function cancelBackend(
  config: PostgresConfig,
  pid: number
): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Invalid PID");
  }
  return withClient(config, undefined, async (client) => {
    const res = await client.query<{ ok: boolean }>(
      `select pg_cancel_backend($1) as ok`,
      [pid]
    );
    return Boolean(res.rows[0]?.ok);
  });
}

export async function terminateBackend(
  config: PostgresConfig,
  pid: number
): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Invalid PID");
  }
  return withClient(config, undefined, async (client) => {
    const res = await client.query<{ ok: boolean }>(
      `select pg_terminate_backend($1) as ok`,
      [pid]
    );
    return Boolean(res.rows[0]?.ok);
  });
}

export interface LockEdge {
  blockedPid: number;
  blockedQuery: string | null;
  blockedUser: string | null;
  blockedDatabase: string | null;
  blockedState: string | null;
  blockingPid: number;
  blockingQuery: string | null;
  blockingUser: string | null;
  blockingDatabase: string | null;
  blockingState: string | null;
  relation: string | null;
  lockMode: string | null;
  waitSeconds: number | null;
}

export async function listBlockingTree(
  config: PostgresConfig
): Promise<LockEdge[]> {
  return withClient(config, undefined, async (client) => {
    const res = await client.query<{
      blocked_pid: number;
      blocked_query: string | null;
      blocked_user: string | null;
      blocked_database: string | null;
      blocked_state: string | null;
      blocking_pid: number;
      blocking_query: string | null;
      blocking_user: string | null;
      blocking_database: string | null;
      blocking_state: string | null;
      relation: string | null;
      lock_mode: string | null;
      wait_seconds: string | null;
    }>(
      `select bl.pid as blocked_pid,
              bla.query as blocked_query,
              bla.usename as blocked_user,
              bla.datname as blocked_database,
              bla.state as blocked_state,
              kl.pid as blocking_pid,
              kla.query as blocking_query,
              kla.usename as blocking_user,
              kla.datname as blocking_database,
              kla.state as blocking_state,
              coalesce(bl.relation::regclass::text, '') as relation,
              bl.mode as lock_mode,
              extract(epoch from (now() - bla.query_start))::float8::text as wait_seconds
       from pg_locks bl
       join pg_stat_activity bla on bla.pid = bl.pid
       join pg_locks kl on bl.locktype = kl.locktype
         and not bl.granted and kl.granted
         and ((bl.relation = kl.relation) or (bl.transactionid = kl.transactionid))
         and bl.pid <> kl.pid
       join pg_stat_activity kla on kla.pid = kl.pid
       order by blocked_pid, blocking_pid`
    );
    return res.rows.map((r) => ({
      blockedPid: r.blocked_pid,
      blockedQuery: r.blocked_query,
      blockedUser: r.blocked_user,
      blockedDatabase: r.blocked_database,
      blockedState: r.blocked_state,
      blockingPid: r.blocking_pid,
      blockingQuery: r.blocking_query,
      blockingUser: r.blocking_user,
      blockingDatabase: r.blocking_database,
      blockingState: r.blocking_state,
      relation: r.relation || null,
      lockMode: r.lock_mode,
      waitSeconds: r.wait_seconds ? Number(r.wait_seconds) : null,
    }));
  });
}

export type MaintenanceMode = "vacuum" | "vacuumFull" | "analyze" | "vacuumAnalyze";

export async function runMaintenance(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  mode: MaintenanceMode
): Promise<void> {
  const ident = tableIdent(
    validateIdentifier(schema, "Schema"),
    validateIdentifier(table, "Table")
  );
  let sql: string;
  switch (mode) {
    case "vacuum":
      sql = `VACUUM ${ident}`;
      break;
    case "vacuumFull":
      sql = `VACUUM FULL ${ident}`;
      break;
    case "analyze":
      sql = `ANALYZE ${ident}`;
      break;
    case "vacuumAnalyze":
      sql = `VACUUM ANALYZE ${ident}`;
      break;
  }
  await withClient(config, database, async (client) => {
    // VACUUM cannot run inside a transaction; pg client uses simple-query path
    // so we just issue it directly.
    await client.query(sql);
  });
}

export async function reindexTable(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string
): Promise<void> {
  const ident = tableIdent(
    validateIdentifier(schema, "Schema"),
    validateIdentifier(table, "Table")
  );
  await withClient(config, database, async (client) => {
    await client.query(`REINDEX TABLE ${ident}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Overview extras — the DBA + dev "first-10-seconds" signals
// ─────────────────────────────────────────────────────────────────────────

export interface OverviewExtras {
  /** Total blocked sessions (count from pg_blocking_pids). */
  blockerCount: number;
  /** Top blocker chains (blocked PID + blocker PIDs + queries), max 5. */
  blockerChains: Array<{
    blockedPid: number;
    blockedQuery: string | null;
    blockedFor: number; // seconds
    blockedBy: number[];
  }>;
  /** Oldest backend in `idle in transaction` state — seconds since state_change. */
  oldestIdleInTxnSec: number | null;
  /** Longest currently-active query — seconds since query_start. */
  longestActiveQuerySec: number | null;
  /** Monotonic transaction counters per database (raw — client diffs for rate). */
  databaseCounters: Array<{
    name: string;
    commits: number;
    rollbacks: number;
    hitPct: number | null;
    /** Snapshot taken at this Unix-ms timestamp. */
    sampledAt: number;
  }>;
  /** Whether the pg_stat_statements extension is installed and visible. */
  hasPgStatStatements: boolean;
  /**
   * Top slow queries by total exec time (only present when
   * pg_stat_statements is installed). Limited to 5 rows.
   */
  topSlowQueries: Array<{
    query: string;
    calls: number;
    totalExecMs: number;
    meanExecMs: number;
    rows: number;
  }>;
  /** Top tables with >20% dead-tuple ratio (autovacuum laggards). Top 5. */
  bloatHotspots: Array<{
    schema: string;
    table: string;
    nLive: number;
    nDead: number;
    deadPct: number;
    lastAutovacuum: string | null;
  }>;
}

export async function getOverviewExtras(
  config: PostgresConfig,
): Promise<OverviewExtras> {
  return withClient(config, undefined, async (client) => {
    const sampledAt = Date.now();
    // Run the heavy queries in parallel — each one is cheap (uses pg_stat_*).
    const [blockers, longest, counters, ext, bloat] = await Promise.all([
      client.query<{
        blocked_pid: number;
        blocked_query: string | null;
        blocked_for: string | null;
        blocked_by: number[];
      }>(
        `select blocked.pid as blocked_pid,
                blocked.query as blocked_query,
                extract(epoch from (now() - blocked.xact_start))::float8::text as blocked_for,
                pg_blocking_pids(blocked.pid) as blocked_by
         from pg_stat_activity blocked
         where cardinality(pg_blocking_pids(blocked.pid)) > 0
         order by blocked.xact_start asc nulls last
         limit 5`,
      ),
      client.query<{
        oldest_idle: string | null;
        longest_active: string | null;
      }>(
        `select
           extract(epoch from (now() - max(state_change)
             filter (where state = 'idle in transaction')
           ))::float8::text as oldest_idle,
           extract(epoch from (now() - min(query_start)
             filter (where state = 'active')
           ))::float8::text as longest_active
         from pg_stat_activity
         where pid <> pg_backend_pid()`,
      ),
      client.query<{
        datname: string;
        xact_commit: string;
        xact_rollback: string;
        hit: string | null;
      }>(
        `select datname,
                xact_commit::text,
                xact_rollback::text,
                case when sum(blks_hit + blks_read) over (partition by datname) = 0
                  then null
                  else (blks_hit::float8 / nullif(blks_hit + blks_read, 0))
                end::text as hit
         from pg_stat_database
         where datname is not null`,
      ),
      client.query<{ has: boolean }>(
        `select exists (
           select 1 from pg_extension where extname = 'pg_stat_statements'
         ) as has`,
      ),
      client.query<{
        schemaname: string;
        relname: string;
        n_live_tup: string;
        n_dead_tup: string;
        last_autovacuum: string | null;
      }>(
        `select schemaname,
                relname,
                n_live_tup::text,
                n_dead_tup::text,
                last_autovacuum::text
         from pg_stat_user_tables
         where n_dead_tup > 1000
           and n_live_tup > 0
           and (n_dead_tup::float8 / nullif(n_live_tup, 0)) > 0.2
         order by n_dead_tup desc
         limit 5`,
      ),
    ]);

    // Slowest queries — only attempt when the extension is installed,
    // and silently swallow errors if the view isn't accessible (perm).
    let topSlowQueries: OverviewExtras["topSlowQueries"] = [];
    if (ext.rows[0]?.has) {
      try {
        const sq = await client.query<{
          query: string;
          calls: string;
          total_exec_time: string;
          mean_exec_time: string;
          rows: string;
        }>(
          `select query,
                  calls::text,
                  total_exec_time::text,
                  mean_exec_time::text,
                  rows::text
           from pg_stat_statements
           where query !~* '^(begin|commit|rollback|deallocate|set|reset|show)'
           order by total_exec_time desc
           limit 5`,
        );
        topSlowQueries = sq.rows.map((r) => ({
          query: r.query,
          calls: Number(r.calls),
          totalExecMs: Number(r.total_exec_time),
          meanExecMs: Number(r.mean_exec_time),
          rows: Number(r.rows),
        }));
      } catch {
        // pg_stat_statements installed but not granted to this role —
        // hide gracefully.
      }
    }

    return {
      blockerCount: blockers.rows.length,
      blockerChains: blockers.rows.map((r) => ({
        blockedPid: r.blocked_pid,
        blockedQuery: r.blocked_query,
        blockedFor:
          r.blocked_for != null && r.blocked_for !== ""
            ? Number(r.blocked_for)
            : 0,
        blockedBy: r.blocked_by ?? [],
      })),
      oldestIdleInTxnSec:
        longest.rows[0]?.oldest_idle != null &&
        longest.rows[0]?.oldest_idle !== ""
          ? Number(longest.rows[0].oldest_idle)
          : null,
      longestActiveQuerySec:
        longest.rows[0]?.longest_active != null &&
        longest.rows[0]?.longest_active !== ""
          ? Number(longest.rows[0].longest_active)
          : null,
      databaseCounters: counters.rows.map((r) => ({
        name: r.datname,
        commits: Number(r.xact_commit),
        rollbacks: Number(r.xact_rollback),
        hitPct: r.hit != null ? Number(r.hit) : null,
        sampledAt,
      })),
      hasPgStatStatements: Boolean(ext.rows[0]?.has),
      topSlowQueries,
      bloatHotspots: bloat.rows.map((r) => ({
        schema: r.schemaname,
        table: r.relname,
        nLive: Number(r.n_live_tup),
        nDead: Number(r.n_dead_tup),
        deadPct:
          Number(r.n_dead_tup) /
          Math.max(1, Number(r.n_live_tup) + Number(r.n_dead_tup)),
        lastAutovacuum: r.last_autovacuum,
      })),
    };
  });
}

// ─── Phase C: diagnostics + extension manager ────────────────────────────

export interface ReplicationSlot {
  name: string;
  type: string;
  active: boolean;
  database: string | null;
  walRetainedBytes: number | null;
  walRetainedMb: number;
  restartLsn: string | null;
  confirmedFlushLsn: string | null;
}

export interface ReplicationPeer {
  applicationName: string;
  clientAddr: string | null;
  state: string;
  syncState: string;
  lagBytes: number | null;
  lagSeconds: number | null;
}

export interface DatabaseAge {
  name: string;
  age: number;
  /** % of autovacuum_freeze_max_age burnt (0..100). Approaches 100 → emergency vacuum. */
  pctUsed: number;
}

export interface AutovacuumActive {
  pid: number;
  database: string | null;
  relation: string | null;
  phase: string | null;
  queryStart: string | null;
  state: string | null;
}

export interface DiagnosticsSnapshot {
  sampledAt: number;
  /** pg_stat_bgwriter / pg_stat_checkpointer (PG 17+) */
  checkpoints: {
    timed: number;
    requested: number;
    /** Total time spent writing buffers during checkpoints (ms). */
    writeTimeMs: number;
    /** Total time spent on sync at end of checkpoints (ms). */
    syncTimeMs: number;
    /** Buffers written by checkpointer, bgwriter, and backends. */
    buffersCheckpoint: number;
    buffersClean: number;
    buffersBackend: number;
  };
  wal: {
    /** PG14+: from pg_stat_wal. Null on older PG. */
    walRecords: number | null;
    walBytes: number | null;
    walWriteTimeMs: number | null;
    walSyncTimeMs: number | null;
    currentLsn: string | null;
    /** WAL bytes generated since postmaster start (best-effort). */
    sinceStartBytes: number | null;
  };
  xidWraparound: {
    autovacuumFreezeMaxAge: number;
    /** Worst-case database by age. */
    databases: DatabaseAge[];
  };
  replication: {
    isPrimary: boolean;
    slots: ReplicationSlot[];
    peers: ReplicationPeer[];
  };
  autovacuum: {
    active: AutovacuumActive[];
    /** Tables with the largest dead-tuple count, capped at 10. */
    deadTuples: Array<{
      schema: string;
      table: string;
      liveTuples: number;
      deadTuples: number;
      pctDead: number;
      lastVacuum: string | null;
      lastAutovacuum: string | null;
    }>;
  };
}

export async function getDiagnostics(
  config: PostgresConfig,
): Promise<DiagnosticsSnapshot> {
  return withClient(config, undefined, async (client) => {
    const sampledAt = Date.now();

    // pg_stat_checkpointer arrived in PG17; pg_stat_bgwriter is the
    // compatibility surface. Try checkpointer first, fall back.
    const checkpointerSql = `select
        num_timed::text as timed,
        num_requested::text as requested,
        write_time::text as write_time_ms,
        sync_time::text as sync_time_ms,
        buffers_written::text as buffers_checkpoint
      from pg_stat_checkpointer`;
    const bgwriterSql = `select
        checkpoints_timed::text as timed,
        checkpoints_req::text as requested,
        checkpoint_write_time::text as write_time_ms,
        checkpoint_sync_time::text as sync_time_ms,
        buffers_checkpoint::text as buffers_checkpoint,
        buffers_clean::text as buffers_clean,
        buffers_backend::text as buffers_backend
      from pg_stat_bgwriter`;

    const checkpoints: DiagnosticsSnapshot["checkpoints"] = {
      timed: 0,
      requested: 0,
      writeTimeMs: 0,
      syncTimeMs: 0,
      buffersCheckpoint: 0,
      buffersClean: 0,
      buffersBackend: 0,
    };
    try {
      // Both views may exist in PG17 — fetch in parallel.
      const [chk, bg] = await Promise.all([
        client
          .query<{
            timed: string;
            requested: string;
            write_time_ms: string;
            sync_time_ms: string;
            buffers_checkpoint: string;
          }>(checkpointerSql)
          .catch(() => null),
        client
          .query<{
            timed: string;
            requested: string;
            write_time_ms: string;
            sync_time_ms: string;
            buffers_checkpoint: string;
            buffers_clean: string;
            buffers_backend: string;
          }>(bgwriterSql)
          .catch(() => null),
      ]);
      if (chk?.rows[0]) {
        const r = chk.rows[0];
        checkpoints.timed = Number(r.timed) || 0;
        checkpoints.requested = Number(r.requested) || 0;
        checkpoints.writeTimeMs = Number(r.write_time_ms) || 0;
        checkpoints.syncTimeMs = Number(r.sync_time_ms) || 0;
        checkpoints.buffersCheckpoint = Number(r.buffers_checkpoint) || 0;
      }
      if (bg?.rows[0]) {
        const r = bg.rows[0];
        // Prefer pg_stat_bgwriter for fields not in pg_stat_checkpointer.
        checkpoints.buffersClean = Number(r.buffers_clean) || 0;
        checkpoints.buffersBackend = Number(r.buffers_backend) || 0;
        if (!chk) {
          checkpoints.timed = Number(r.timed) || 0;
          checkpoints.requested = Number(r.requested) || 0;
          checkpoints.writeTimeMs = Number(r.write_time_ms) || 0;
          checkpoints.syncTimeMs = Number(r.sync_time_ms) || 0;
          checkpoints.buffersCheckpoint = Number(r.buffers_checkpoint) || 0;
        }
      }
    } catch {
      // leave defaults
    }

    // WAL stats. pg_stat_wal exists from PG14.
    const wal: DiagnosticsSnapshot["wal"] = {
      walRecords: null,
      walBytes: null,
      walWriteTimeMs: null,
      walSyncTimeMs: null,
      currentLsn: null,
      sinceStartBytes: null,
    };
    try {
      const [w, lsn] = await Promise.all([
        client
          .query<{
            wal_records: string;
            wal_bytes: string;
            wal_write_time: string;
            wal_sync_time: string;
          }>(
            `select wal_records::text, wal_bytes::text,
                    wal_write_time::text, wal_sync_time::text
             from pg_stat_wal`,
          )
          .catch(() => null),
        client
          .query<{
            current_lsn: string | null;
            insert_lsn: string | null;
            start_lsn: string | null;
          }>(
            `select
               case when pg_is_in_recovery() then null
                    else pg_current_wal_lsn()::text end as current_lsn,
               case when pg_is_in_recovery() then null
                    else pg_current_wal_insert_lsn()::text end as insert_lsn,
               (select pg_walfile_name(coalesce(
                  case when pg_is_in_recovery() then null
                       else pg_current_wal_lsn() end,
                  '0/0'::pg_lsn))) as start_lsn`,
          )
          .catch(() => null),
      ]);
      if (w?.rows[0]) {
        wal.walRecords = Number(w.rows[0].wal_records);
        wal.walBytes = Number(w.rows[0].wal_bytes);
        wal.walWriteTimeMs = Number(w.rows[0].wal_write_time);
        wal.walSyncTimeMs = Number(w.rows[0].wal_sync_time);
      }
      if (lsn?.rows[0]) {
        wal.currentLsn = lsn.rows[0].current_lsn;
      }
    } catch {
      // leave defaults
    }

    const [xidSetting, dbAge, repPrimary, slots, peers, vacActive, dead] =
      await Promise.all([
        client.query<{ v: string }>(
          `select current_setting('autovacuum_freeze_max_age') as v`,
        ),
        client.query<{ name: string; age: string }>(
          `select datname as name, age(datfrozenxid)::text as age
           from pg_database
           where datallowconn
           order by age(datfrozenxid) desc`,
        ),
        client.query<{ p: boolean }>(
          `select not pg_is_in_recovery() as p`,
        ),
        client.query<{
          slot_name: string;
          slot_type: string;
          active: boolean;
          database: string | null;
          restart_lsn: string | null;
          confirmed_flush_lsn: string | null;
          retained: string | null;
        }>(
          `select * from (
             select slot_name, slot_type, active, database,
                    restart_lsn::text,
                    confirmed_flush_lsn::text,
                    case when not pg_is_in_recovery()
                         and restart_lsn is not null
                         then (pg_current_wal_lsn() - restart_lsn)
                         else null end as retained
             from pg_replication_slots
           ) s
           order by retained desc nulls last`,
        ),
        client.query<{
          application_name: string;
          client_addr: string | null;
          state: string;
          sync_state: string;
          lag_bytes: string | null;
          lag_seconds: string | null;
        }>(
          `select application_name, client_addr::text,
                  state, sync_state,
                  case when not pg_is_in_recovery()
                       then (pg_current_wal_lsn() - replay_lsn)::text
                       else null end as lag_bytes,
                  extract(epoch from (now() - reply_time))::float8::text as lag_seconds
           from pg_stat_replication`,
        ),
        client.query<{
          pid: number;
          datname: string | null;
          relid: string | null;
          phase: string | null;
          query_start: string | null;
          state: string | null;
        }>(
          `select a.pid, a.datname,
                  case when v.relid is not null
                       then (select relnamespace::regnamespace || '.' || relname
                             from pg_class where oid = v.relid)
                       else null end as relid,
                  v.phase, a.query_start::text, a.state
           from pg_stat_activity a
           left join pg_stat_progress_vacuum v on v.pid = a.pid
           where a.backend_type = 'autovacuum worker'
              or a.query ilike 'autovacuum:%'
              or v.pid is not null
           order by a.query_start asc nulls last`,
        ),
        client.query<{
          schemaname: string;
          relname: string;
          n_live_tup: string;
          n_dead_tup: string;
          last_vacuum: string | null;
          last_autovacuum: string | null;
        }>(
          `select schemaname, relname,
                  n_live_tup::text, n_dead_tup::text,
                  last_vacuum::text, last_autovacuum::text
           from pg_stat_all_tables
           where schemaname not in ('pg_catalog', 'information_schema')
             and n_dead_tup > 0
           order by n_dead_tup desc
           limit 10`,
        ),
      ]);

    const freezeMax = Number(xidSetting.rows[0]?.v ?? "200000000");
    const xidDatabases: DatabaseAge[] = dbAge.rows.map((r) => {
      const age = Number(r.age) || 0;
      return {
        name: r.name,
        age,
        pctUsed: Math.min(100, (age / freezeMax) * 100),
      };
    });

    return {
      sampledAt,
      checkpoints,
      wal,
      xidWraparound: {
        autovacuumFreezeMaxAge: freezeMax,
        databases: xidDatabases,
      },
      replication: {
        isPrimary: repPrimary.rows[0]?.p ?? true,
        slots: slots.rows.map((r) => {
          const bytes = r.retained != null ? Number(r.retained) : null;
          return {
            name: r.slot_name,
            type: r.slot_type,
            active: r.active,
            database: r.database,
            walRetainedBytes: bytes,
            walRetainedMb: bytes ? bytes / (1024 * 1024) : 0,
            restartLsn: r.restart_lsn,
            confirmedFlushLsn: r.confirmed_flush_lsn,
          };
        }),
        peers: peers.rows.map((r) => ({
          applicationName: r.application_name,
          clientAddr: r.client_addr,
          state: r.state,
          syncState: r.sync_state,
          lagBytes: r.lag_bytes != null ? Number(r.lag_bytes) : null,
          lagSeconds:
            r.lag_seconds != null ? Number(r.lag_seconds) : null,
        })),
      },
      autovacuum: {
        active: vacActive.rows.map((r) => ({
          pid: r.pid,
          database: r.datname,
          relation: r.relid,
          phase: r.phase,
          queryStart: r.query_start,
          state: r.state,
        })),
        deadTuples: dead.rows.map((r) => {
          const live = Number(r.n_live_tup) || 0;
          const ded = Number(r.n_dead_tup) || 0;
          return {
            schema: r.schemaname,
            table: r.relname,
            liveTuples: live,
            deadTuples: ded,
            pctDead: live + ded > 0 ? (ded / (live + ded)) * 100 : 0,
            lastVacuum: r.last_vacuum,
            lastAutovacuum: r.last_autovacuum,
          };
        }),
      },
    };
  });
}

