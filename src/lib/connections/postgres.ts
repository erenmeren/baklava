import { Client, type ClientConfig } from "pg";
import type { PostgresConfig } from "./types";

function buildClientConfig(
  config: PostgresConfig,
  databaseOverride?: string
): ClientConfig {
  return {
    host: config.host,
    port: config.port,
    database: databaseOverride || config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 6000,
    statement_timeout: 15000,
  };
}

async function withClient<T>(
  config: PostgresConfig,
  database: string | undefined,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client(buildClientConfig(config, database));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface PostgresProbe {
  serverVersion: string;
  currentDatabase: string;
  currentUser: string;
}

export async function probePostgres(
  config: PostgresConfig
): Promise<PostgresProbe> {
  return withClient(config, undefined, async (client) => {
    const res = await client.query<{
      version: string;
      current_database: string;
      current_user: string;
    }>(
      "select version() as version, current_database() as current_database, current_user as current_user"
    );
    const row = res.rows[0];
    return {
      serverVersion: row.version,
      currentDatabase: row.current_database,
      currentUser: row.current_user,
    };
  });
}

export interface DatabaseInfo {
  name: string;
  owner: string;
  encoding: string;
  size: number;
}

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

export async function listDatabases(
  config: PostgresConfig
): Promise<DatabaseInfo[]> {
  return withClient(config, undefined, async (client) => {
    const res = await client.query<DatabaseInfo>(
      `select datname as name,
              pg_get_userbyid(datdba) as owner,
              pg_encoding_to_char(encoding) as encoding,
              pg_database_size(datname) as size
       from pg_database
       where datistemplate = false
       order by datname`
    );
    return res.rows.map((r) => ({ ...r, size: Number(r.size) }));
  });
}

export interface SchemaInfo {
  name: string;
  owner: string;
}

export async function listSchemas(
  config: PostgresConfig,
  database: string
): Promise<SchemaInfo[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<SchemaInfo>(
      `select schema_name as name, schema_owner as owner
       from information_schema.schemata
       where schema_name not in ('pg_catalog', 'information_schema', 'pg_toast')
         and schema_name not like 'pg_temp_%'
         and schema_name not like 'pg_toast_temp_%'
       order by schema_name`
    );
    return res.rows;
  });
}

export interface SchemaStats {
  name: string;
  owner: string;
  tables: number;
  views: number;
  materializedViews: number;
  sequences: number;
  functions: number;
  totalSize: number;
}

/**
 * One-shot schema inventory for the per-database overview page. Counts
 * tables / views / matviews / sequences (pg_class) and functions
 * (pg_proc) grouped by namespace, plus a summed pg_total_relation_size
 * across the tables and matviews in each schema.
 */
export async function listSchemasWithStats(
  config: PostgresConfig,
  database: string,
): Promise<SchemaStats[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      name: string;
      owner: string;
      tables: string;
      views: string;
      materialized_views: string;
      sequences: string;
      functions: string;
      total_size: string;
    }>(
      `with rels as (
         select n.nspname,
                count(*) filter (where c.relkind = 'r')::text as tables,
                count(*) filter (where c.relkind = 'v')::text as views,
                count(*) filter (where c.relkind = 'm')::text as materialized_views,
                count(*) filter (where c.relkind = 'S')::text as sequences,
                coalesce(
                  sum(pg_total_relation_size(c.oid))
                    filter (where c.relkind in ('r','m','S')),
                  0
                )::text as total_size
         from pg_namespace n
         left join pg_class c on c.relnamespace = n.oid
         group by n.nspname
       ),
       fns as (
         select n.nspname,
                count(*)::text as functions
         from pg_namespace n
         left join pg_proc p on p.pronamespace = n.oid
         group by n.nspname
       )
       select s.schema_name as name,
              s.schema_owner as owner,
              coalesce(rels.tables, '0') as tables,
              coalesce(rels.views, '0') as views,
              coalesce(rels.materialized_views, '0') as materialized_views,
              coalesce(rels.sequences, '0') as sequences,
              coalesce(fns.functions, '0') as functions,
              coalesce(rels.total_size, '0') as total_size
       from information_schema.schemata s
       left join rels on rels.nspname = s.schema_name
       left join fns on fns.nspname = s.schema_name
       where s.schema_name not in ('pg_catalog', 'information_schema', 'pg_toast')
         and s.schema_name not like 'pg_temp_%'
         and s.schema_name not like 'pg_toast_temp_%'
       order by s.schema_name`,
    );
    return res.rows.map((r) => ({
      name: r.name,
      owner: r.owner,
      tables: Number(r.tables),
      views: Number(r.views),
      materializedViews: Number(r.materialized_views),
      sequences: Number(r.sequences),
      functions: Number(r.functions),
      totalSize: Number(r.total_size),
    }));
  });
}

export type ObjectKind = "table" | "view" | "materialized_view";

export interface SchemaObject {
  name: string;
  kind: ObjectKind;
  rowEstimate: number;
}

export async function listObjects(
  config: PostgresConfig,
  database: string,
  schema: string
): Promise<SchemaObject[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      name: string;
      kind: string;
      row_estimate: string | number;
    }>(
      `select c.relname as name,
              case c.relkind
                when 'r' then 'table'
                when 'v' then 'view'
                when 'm' then 'materialized_view'
                else c.relkind::text
              end as kind,
              c.reltuples::bigint as row_estimate
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1
         and c.relkind in ('r','v','m')
       order by c.relname`,
      [schema]
    );
    return res.rows.map((r) => ({
      name: r.name,
      kind: r.kind as ObjectKind,
      rowEstimate: Number(r.row_estimate),
    }));
  });
}

// ─── All relations + columns (for Cmd+K palette) ────────────────────────

export interface RelationListing {
  schema: string;
  name: string;
  /** r=table, v=view, m=matview, f=foreign table */
  kind: "table" | "view" | "matview" | "foreign";
  /** Column names; may be empty for views with no expanded columns. */
  columns: string[];
  /** True when the relation lives in a system schema we can use but
   *  don't want to surface by default. */
  isSystem: boolean;
}

/**
 * Flat list of all tables/views/matviews in the given database with
 * their column names. One query, joined at the server. Used by the
 * Cmd+K palette so fuzzy search can hit table AND column names without
 * round-tripping.
 *
 * pg_attribute is huge on a per-row basis — we join + aggregate by
 * relation so the client sees one row per relation.
 */
export async function listAllRelations(
  config: PostgresConfig,
  database: string,
): Promise<RelationListing[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      schema: string;
      name: string;
      kind: string;
      columns: string[] | null;
      is_system: boolean;
    }>(
      `select n.nspname as schema,
              c.relname as name,
              case c.relkind
                when 'r' then 'table'
                when 'v' then 'view'
                when 'm' then 'matview'
                when 'f' then 'foreign'
                else c.relkind::text
              end as kind,
              array(
                select a.attname
                from pg_attribute a
                where a.attrelid = c.oid
                  and a.attnum > 0
                  and not a.attisdropped
                order by a.attnum
              ) as columns,
              (n.nspname in ('pg_catalog', 'information_schema')
                or n.nspname like 'pg_%') as is_system
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'v', 'm', 'f')
         and n.nspname not in ('pg_toast')
         and n.nspname not like 'pg_temp_%'
         and n.nspname not like 'pg_toast_temp_%'
       order by is_system, n.nspname, c.relname`,
    );
    return res.rows.map((r) => ({
      schema: r.schema,
      name: r.name,
      kind: r.kind as RelationListing["kind"],
      columns: r.columns ?? [],
      isSystem: r.is_system,
    }));
  });
}

export interface ColumnInfo {
  name: string;
  position: number;
  dataType: string;
  isNullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  comment: string | null;
}

export async function listColumns(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string
): Promise<ColumnInfo[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      name: string;
      position: number;
      data_type: string;
      is_nullable: string;
      default: string | null;
      is_primary_key: boolean;
      is_unique: boolean;
      comment: string | null;
    }>(
      `select c.column_name as name,
              c.ordinal_position as position,
              format_type(a.atttypid, a.atttypmod) as data_type,
              c.is_nullable as is_nullable,
              c.column_default as default,
              coalesce((
                select true
                from pg_index i
                where i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
                  and i.indisprimary
                  and a.attnum = any(i.indkey)
              ), false) as is_primary_key,
              coalesce((
                select true
                from pg_index i
                where i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
                  and i.indisunique
                  and not i.indisprimary
                  and i.indnatts = 1
                  and i.indkey[0] = a.attnum
              ), false) as is_unique,
              col_description(
                (quote_ident($1) || '.' || quote_ident($2))::regclass,
                a.attnum
              ) as comment
       from information_schema.columns c
       join pg_attribute a on a.attname = c.column_name
         and a.attrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
       where c.table_schema = $1 and c.table_name = $2
       order by c.ordinal_position`,
      [schema, table]
    );
    return res.rows.map((r) => ({
      name: r.name,
      position: r.position,
      dataType: r.data_type,
      isNullable: r.is_nullable === "YES",
      default: r.default,
      isPrimaryKey: r.is_primary_key,
      isUnique: r.is_unique,
      comment: r.comment,
    }));
  });
}

export interface IndexInfo {
  name: string;
  definition: string;
  isUnique: boolean;
  isPrimary: boolean;
}

export async function listIndexes(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string
): Promise<IndexInfo[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      name: string;
      definition: string;
      is_unique: boolean;
      is_primary: boolean;
    }>(
      `select i.indexname as name,
              i.indexdef as definition,
              x.indisunique as is_unique,
              x.indisprimary as is_primary
       from pg_indexes i
       join pg_class c on c.relname = i.indexname
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = i.schemaname
       join pg_index x on x.indexrelid = c.oid
       where i.schemaname = $1 and i.tablename = $2
       order by i.indexname`,
      [schema, table]
    );
    return res.rows.map((r) => ({
      name: r.name,
      definition: r.definition,
      isUnique: r.is_unique,
      isPrimary: r.is_primary,
    }));
  });
}

export interface ConstraintInfo {
  name: string;
  type: string;
  definition: string;
}

export async function listConstraints(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string
): Promise<ConstraintInfo[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      name: string;
      type: string;
      definition: string;
    }>(
      `select conname as name,
              case contype
                when 'p' then 'PRIMARY KEY'
                when 'f' then 'FOREIGN KEY'
                when 'u' then 'UNIQUE'
                when 'c' then 'CHECK'
                when 'x' then 'EXCLUDE'
                else contype::text
              end as type,
              pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
       order by conname`,
      [schema, table]
    );
    return res.rows;
  });
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export async function listForeignKeys(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string
): Promise<ForeignKeyInfo[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      name: string;
      columns: string[];
      ref_schema: string;
      ref_table: string;
      ref_columns: string[];
      on_update: string;
      on_delete: string;
    }>(
      `with fks as (
         select c.conname as name,
                c.conrelid::regclass as table_full,
                c.confrelid::regclass as ref_table_full,
                c.confupdtype as upd,
                c.confdeltype as del,
                array(
                  select attname::text
                  from unnest(c.conkey) k
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
                  order by array_position(c.conkey, k)
                )::text[] as columns,
                array(
                  select attname::text
                  from unnest(c.confkey) k
                  join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k
                  order by array_position(c.confkey, k)
                )::text[] as ref_columns,
                cn.nspname as ref_schema,
                cnf.nspname as schema
         from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
         join pg_namespace cnf on cnf.oid = cl.relnamespace
         join pg_class clr on clr.oid = c.confrelid
         join pg_namespace cn on cn.oid = clr.relnamespace
         where c.contype = 'f'
       )
       select name,
              columns,
              ref_schema,
              regexp_replace(ref_table_full::text, '^[^.]+\\.', '') as ref_table,
              ref_columns,
              case upd when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' else upd::text end as on_update,
              case del when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' else del::text end as on_delete
       from fks
       where schema = $1
         and regexp_replace(table_full::text, '^[^.]+\\.', '') = $2`,
      [schema, table]
    );
    return res.rows.map((r) => ({
      name: r.name,
      columns: Array.isArray(r.columns) ? r.columns : [],
      refSchema: r.ref_schema,
      refTable: r.ref_table,
      refColumns: Array.isArray(r.ref_columns) ? r.ref_columns : [],
      onUpdate: r.on_update,
      onDelete: r.on_delete,
    }));
  });
}

export interface TableData {
  fields: { name: string; dataType: string }[];
  rows: unknown[][];
  rowCount: number;
  totalRows: number | null;
}

export async function readTableData(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  limit: number,
  offset: number
): Promise<TableData> {
  return withClient(config, database, async (client) => {
    const ident = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    const res = await client.query({
      text: `select * from ${ident} limit $1 offset $2`,
      values: [limit, offset],
      rowMode: "array",
    });
    let totalRows: number | null = null;
    try {
      const c = await client.query<{ count: string }>(
        `select count(*)::text as count from ${ident}`
      );
      totalRows = Number(c.rows[0].count);
    } catch {
      // ignore — large tables, we already have rowEstimate
    }
    return {
      fields: res.fields.map((f) => ({
        name: f.name,
        dataType: pgTypeName(f.dataTypeID),
      })),
      rows: res.rows as unknown[][],
      rowCount: res.rowCount ?? res.rows.length,
      totalRows,
    };
  });
}

export type ColumnValue =
  | { kind: "null" }
  | { kind: "default" }
  | { kind: "value"; value: string };

export interface PrimaryKeyValue {
  column: string;
  value: unknown;
}

/** @internal — exported for tests; SQL-safety helpers. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function tableIdent(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function paramFor(v: ColumnValue): { skip: true } | { skip: false; value: unknown } {
  if (v.kind === "default") return { skip: true };
  if (v.kind === "null") return { skip: false, value: null };
  return { skip: false, value: v.value };
}

export async function insertRow(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  values: Record<string, ColumnValue>
): Promise<{ rowsAffected: number }> {
  const cols: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];
  for (const [col, v] of Object.entries(values)) {
    const p = paramFor(v);
    if (p.skip) continue;
    cols.push(quoteIdent(col));
    params.push(p.value);
    placeholders.push(`$${params.length}`);
  }
  return withClient(config, database, async (client) => {
    const sql =
      cols.length === 0
        ? `insert into ${tableIdent(schema, table)} default values`
        : `insert into ${tableIdent(schema, table)} (${cols.join(", ")}) values (${placeholders.join(", ")})`;
    const res = await client.query(sql, params);
    return { rowsAffected: res.rowCount ?? 0 };
  });
}

export async function updateRow(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  pk: PrimaryKeyValue[],
  values: Record<string, ColumnValue>
): Promise<{ rowsAffected: number }> {
  if (pk.length === 0) {
    throw new Error("Cannot update: no primary key on this table");
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [col, v] of Object.entries(values)) {
    const p = paramFor(v);
    if (p.skip) continue;
    params.push(p.value);
    sets.push(`${quoteIdent(col)} = $${params.length}`);
  }
  if (sets.length === 0) {
    throw new Error("No columns to update");
  }
  const wheres = pk.map((item) => {
    params.push(item.value);
    return `${quoteIdent(item.column)} = $${params.length}`;
  });
  const sql = `update ${tableIdent(schema, table)} set ${sets.join(", ")} where ${wheres.join(" and ")}`;
  return withClient(config, database, async (client) => {
    const res = await client.query(sql, params);
    return { rowsAffected: res.rowCount ?? 0 };
  });
}

export interface CreateTableColumnInput {
  name: string;
  dataType: string;
  nullable: boolean;
  default?: string;
  isPrimaryKey: boolean;
}

export interface CreateTableInput {
  schema: string;
  name: string;
  columns: CreateTableColumnInput[];
  ifNotExists?: boolean;
}

export async function createTable(
  config: PostgresConfig,
  database: string,
  input: CreateTableInput
): Promise<void> {
  if (!input.name.trim()) {
    throw new Error("Table name is required");
  }
  if (!input.columns.length) {
    throw new Error("At least one column is required");
  }
  const seen = new Set<string>();
  for (const c of input.columns) {
    if (!c.name.trim()) throw new Error("Every column needs a name");
    if (!c.dataType.trim()) {
      throw new Error(`Column "${c.name}" needs a data type`);
    }
    const key = c.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate column name "${c.name}"`);
    }
    seen.add(key);
  }

  const colDefs = input.columns.map((c) => {
    const parts = [
      quoteIdent(c.name.trim()),
      requireNoStatementTerminator(c.dataType.trim(), "Column type"),
    ];
    if (!c.nullable) parts.push("NOT NULL");
    if (c.default && c.default.trim()) {
      parts.push(
        `DEFAULT ${requireNoStatementTerminator(c.default.trim(), "Default expression")}`,
      );
    }
    return parts.join(" ");
  });

  const pkCols = input.columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length) {
    colDefs.push(
      `PRIMARY KEY (${pkCols.map((c) => quoteIdent(c.name.trim())).join(", ")})`
    );
  }

  const ifNotExists = input.ifNotExists ? "IF NOT EXISTS " : "";
  const sql = `CREATE TABLE ${ifNotExists}${tableIdent(input.schema, input.name.trim())} (\n  ${colDefs.join(",\n  ")}\n)`;

  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function deleteRow(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  pk: PrimaryKeyValue[]
): Promise<{ rowsAffected: number }> {
  if (pk.length === 0) {
    throw new Error("Cannot delete: no primary key on this table");
  }
  const params: unknown[] = [];
  const wheres = pk.map((item) => {
    params.push(item.value);
    return `${quoteIdent(item.column)} = $${params.length}`;
  });
  const sql = `delete from ${tableIdent(schema, table)} where ${wheres.join(" and ")}`;
  return withClient(config, database, async (client) => {
    const res = await client.query(sql, params);
    return { rowsAffected: res.rowCount ?? 0 };
  });
}

export interface FunctionInfo {
  name: string;
  language: string;
  returnType: string;
  arguments: string;
  kind: "function" | "procedure" | "aggregate" | "window";
}

export async function listFunctions(
  config: PostgresConfig,
  database: string,
  schema: string
): Promise<FunctionInfo[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      name: string;
      language: string;
      return_type: string;
      arguments: string;
      kind: string;
    }>(
      `select p.proname as name,
              l.lanname as language,
              pg_get_function_result(p.oid) as return_type,
              pg_get_function_arguments(p.oid) as arguments,
              case p.prokind
                when 'f' then 'function'
                when 'p' then 'procedure'
                when 'a' then 'aggregate'
                when 'w' then 'window'
                else p.prokind::text
              end as kind
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_language l on l.oid = p.prolang
       where n.nspname = $1
       order by p.proname`,
      [schema]
    );
    return res.rows.map((r) => ({
      name: r.name,
      language: r.language,
      returnType: r.return_type,
      arguments: r.arguments,
      kind: r.kind as FunctionInfo["kind"],
    }));
  });
}

export interface SequenceInfo {
  name: string;
  dataType: string;
  startValue: string;
  minValue: string;
  maxValue: string;
  increment: string;
  lastValue: string | null;
}

export async function listSequences(
  config: PostgresConfig,
  database: string,
  schema: string
): Promise<SequenceInfo[]> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      name: string;
      data_type: string;
      start_value: string;
      minimum_value: string;
      maximum_value: string;
      increment: string;
      last_value: string | null;
    }>(
      `select s.sequence_name as name,
              s.data_type,
              s.start_value::text as start_value,
              s.minimum_value::text as minimum_value,
              s.maximum_value::text as maximum_value,
              s.increment::text as increment,
              (select last_value::text from pg_sequences ps
                where ps.schemaname = s.sequence_schema
                  and ps.sequencename = s.sequence_name) as last_value
       from information_schema.sequences s
       where s.sequence_schema = $1
       order by s.sequence_name`,
      [schema]
    );
    return res.rows.map((r) => ({
      name: r.name,
      dataType: r.data_type,
      startValue: r.start_value,
      minValue: r.minimum_value,
      maxValue: r.maximum_value,
      increment: r.increment,
      lastValue: r.last_value,
    }));
  });
}

export interface TableStats {
  /** 'r' table, 'v' view, 'm' materialized view, 'p' partitioned, 'f' foreign. */
  relKind: string;
  /** True once ANALYZE has populated reltuples (i.e. rowEstimate >= 0). */
  analyzed: boolean;
  rowEstimate: number;
  totalSize: number;
  tableSize: number;
  indexSize: number;
  toastSize: number;
  liveTuples: number;
  deadTuples: number;
  seqScan: number;
  seqTupRead: number;
  idxScan: number;
  idxTupFetch: number;
  nTupIns: number;
  nTupUpd: number;
  nTupDel: number;
  nTupHotUpd: number;
  vacuumCount: number;
  autovacuumCount: number;
  analyzeCount: number;
  autoanalyzeCount: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
}

export async function getTableStats(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
): Promise<TableStats> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{
      rel_kind: string;
      row_estimate: string;
      total_size: string;
      table_size: string;
      index_size: string;
      toast_size: string;
      live_tuples: string | null;
      dead_tuples: string | null;
      seq_scan: string | null;
      seq_tup_read: string | null;
      idx_scan: string | null;
      idx_tup_fetch: string | null;
      n_tup_ins: string | null;
      n_tup_upd: string | null;
      n_tup_del: string | null;
      n_tup_hot_upd: string | null;
      vacuum_count: string | null;
      autovacuum_count: string | null;
      analyze_count: string | null;
      autoanalyze_count: string | null;
      last_vacuum: string | null;
      last_autovacuum: string | null;
      last_analyze: string | null;
      last_autoanalyze: string | null;
    }>(
      `select
         c.relkind::text as rel_kind,
         c.reltuples::bigint::text as row_estimate,
         pg_total_relation_size(c.oid)::text as total_size,
         pg_relation_size(c.oid)::text as table_size,
         pg_indexes_size(c.oid)::text as index_size,
         coalesce(pg_total_relation_size(c.reltoastrelid), 0)::text as toast_size,
         s.n_live_tup::text as live_tuples,
         s.n_dead_tup::text as dead_tuples,
         s.seq_scan::text as seq_scan,
         s.seq_tup_read::text as seq_tup_read,
         s.idx_scan::text as idx_scan,
         s.idx_tup_fetch::text as idx_tup_fetch,
         s.n_tup_ins::text as n_tup_ins,
         s.n_tup_upd::text as n_tup_upd,
         s.n_tup_del::text as n_tup_del,
         s.n_tup_hot_upd::text as n_tup_hot_upd,
         s.vacuum_count::text as vacuum_count,
         s.autovacuum_count::text as autovacuum_count,
         s.analyze_count::text as analyze_count,
         s.autoanalyze_count::text as autoanalyze_count,
         s.last_vacuum::text as last_vacuum,
         s.last_autovacuum::text as last_autovacuum,
         s.last_analyze::text as last_analyze,
         s.last_autoanalyze::text as last_autoanalyze
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s
         on s.schemaname = n.nspname and s.relname = c.relname
       where n.nspname = $1 and c.relname = $2`,
      [schema, table],
    );
    const r = res.rows[0];
    if (!r) throw new Error(`Table ${schema}.${table} not found`);
    const num = (v: string | null) => Number(v ?? "0");
    const rowEstimate = num(r.row_estimate);
    return {
      relKind: r.rel_kind,
      analyzed: rowEstimate >= 0,
      rowEstimate,
      totalSize: num(r.total_size),
      tableSize: num(r.table_size),
      indexSize: num(r.index_size),
      toastSize: num(r.toast_size),
      liveTuples: num(r.live_tuples),
      deadTuples: num(r.dead_tuples),
      seqScan: num(r.seq_scan),
      seqTupRead: num(r.seq_tup_read),
      idxScan: num(r.idx_scan),
      idxTupFetch: num(r.idx_tup_fetch),
      nTupIns: num(r.n_tup_ins),
      nTupUpd: num(r.n_tup_upd),
      nTupDel: num(r.n_tup_del),
      nTupHotUpd: num(r.n_tup_hot_upd),
      vacuumCount: num(r.vacuum_count),
      autovacuumCount: num(r.autovacuum_count),
      analyzeCount: num(r.analyze_count),
      autoanalyzeCount: num(r.autoanalyze_count),
      lastVacuum: r.last_vacuum,
      lastAutovacuum: r.last_autovacuum,
      lastAnalyze: r.last_analyze,
      lastAutoanalyze: r.last_autoanalyze,
    };
  });
}

export interface SequenceOptions {
  start?: string;
  increment?: string;
  minValue?: string | null; // null clears (NO MINVALUE)
  maxValue?: string | null; // null clears (NO MAXVALUE)
  cache?: string;
  cycle?: boolean;
}

function buildSequenceClauses(opts: SequenceOptions): string[] {
  const parts: string[] = [];
  const numeric = (v: string) => {
    if (!/^-?\d+$/.test(v.trim())) {
      throw new Error(`Expected integer, got "${v}"`);
    }
    return v.trim();
  };
  if (opts.start !== undefined) parts.push(`START WITH ${numeric(opts.start)}`);
  if (opts.increment !== undefined)
    parts.push(`INCREMENT BY ${numeric(opts.increment)}`);
  if (opts.minValue !== undefined) {
    parts.push(opts.minValue === null ? "NO MINVALUE" : `MINVALUE ${numeric(opts.minValue)}`);
  }
  if (opts.maxValue !== undefined) {
    parts.push(opts.maxValue === null ? "NO MAXVALUE" : `MAXVALUE ${numeric(opts.maxValue)}`);
  }
  if (opts.cache !== undefined) parts.push(`CACHE ${numeric(opts.cache)}`);
  if (opts.cycle !== undefined) parts.push(opts.cycle ? "CYCLE" : "NO CYCLE");
  return parts;
}

export async function createSequence(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  opts: SequenceOptions = {},
): Promise<void> {
  const trimmed = validateIdentifier(name, "Sequence");
  const clauses = buildSequenceClauses(opts);
  const sql = `CREATE SEQUENCE ${quoteIdent(schema)}.${quoteIdent(trimmed)}${
    clauses.length ? " " + clauses.join(" ") : ""
  }`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function alterSequence(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  opts: SequenceOptions,
): Promise<void> {
  const clauses = buildSequenceClauses(opts);
  if (clauses.length === 0) throw new Error("No changes to apply");
  const sql = `ALTER SEQUENCE ${quoteIdent(schema)}.${quoteIdent(name)} ${clauses.join(" ")}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropSequence(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  options?: { cascade?: boolean; ifExists?: boolean },
): Promise<void> {
  const sql = `DROP SEQUENCE ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(schema)}.${quoteIdent(name)}${options?.cascade ? " CASCADE" : ""}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

/**
 * Execute a CREATE FUNCTION (or CREATE OR REPLACE FUNCTION) statement verbatim.
 * The caller is responsible for the SQL; we only check that it begins with the
 * expected keyword to avoid arbitrary script execution.
 */
export async function createOrReplaceFunction(
  config: PostgresConfig,
  database: string,
  sql: string,
): Promise<void> {
  const trimmed = sql.trim().replace(/;+\s*$/g, "");
  if (!/^create\s+(or\s+replace\s+)?(procedure|function)\b/i.test(trimmed)) {
    throw new Error(
      "SQL must begin with CREATE [OR REPLACE] FUNCTION or PROCEDURE",
    );
  }
  await withClient(config, database, async (client) => {
    await client.query(trimmed);
  });
}

export async function dropFunction(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  argSignature: string,
  options?: { cascade?: boolean; ifExists?: boolean; isProcedure?: boolean },
): Promise<void> {
  const kind = options?.isProcedure ? "PROCEDURE" : "FUNCTION";
  const safeArgs = requireNoStatementTerminator(
    argSignature,
    "Function argument signature",
  );
  const sql = `DROP ${kind} ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(schema)}.${quoteIdent(name)}(${safeArgs})${options?.cascade ? " CASCADE" : ""}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function getFunctionDefinition(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  argSignature: string,
): Promise<string> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{ def: string }>(
      `select pg_get_functiondef(
         (quote_ident($1) || '.' || quote_ident($2) || '(' || $3 || ')')::regprocedure::oid
       ) as def`,
      [schema, name, argSignature],
    );
    return res.rows[0]?.def ?? "";
  });
}

/**
 * Execute CREATE [OR REPLACE] [MATERIALIZED] VIEW verbatim. Refuses anything
 * else so the endpoint can't run arbitrary SQL.
 */
export interface CreateIndexInput {
  /** Optional; Postgres auto-generates a name when omitted. */
  name?: string;
  /** Column expressions (will be quoted as identifiers when alphanumeric). */
  columns: string[];
  unique?: boolean;
  method?: "btree" | "hash" | "gin" | "gist" | "brin" | "spgist";
  /** Optional WHERE for a partial index. */
  where?: string;
  /** CONCURRENTLY — non-blocking but cannot run inside a transaction. */
  concurrent?: boolean;
}

const INDEX_METHODS = new Set([
  "btree",
  "hash",
  "gin",
  "gist",
  "brin",
  "spgist",
]);

function quoteIndexColumn(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error("Column expression is required");
  // If it looks like a bare identifier, quote it; otherwise treat as a raw
  // expression (e.g. `lower(email)`).
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return quoteIdent(trimmed);
  }
  return trimmed;
}

export async function createIndex(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  input: CreateIndexInput,
): Promise<void> {
  if (!input.columns || input.columns.length === 0) {
    throw new Error("At least one column is required");
  }
  if (input.method && !INDEX_METHODS.has(input.method)) {
    throw new Error(`Unknown index method: ${input.method}`);
  }
  const parts: string[] = ["CREATE"];
  if (input.unique) parts.push("UNIQUE");
  parts.push("INDEX");
  if (input.concurrent) parts.push("CONCURRENTLY");
  if (input.name) {
    parts.push(validateIdentifier(input.name, "Index"));
  }
  parts.push("ON", tableIdent(schema, table));
  if (input.method) parts.push(`USING ${input.method}`);
  parts.push(`(${input.columns.map(quoteIndexColumn).join(", ")})`);
  if (input.where && input.where.trim()) {
    parts.push(
      `WHERE ${requireNoStatementTerminator(input.where.trim(), "WHERE clause")}`,
    );
  }
  const sql = parts.join(" ");
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropIndex(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  options?: { cascade?: boolean; ifExists?: boolean; concurrent?: boolean },
): Promise<void> {
  const sql = `DROP INDEX ${options?.concurrent ? "CONCURRENTLY " : ""}${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(schema)}.${quoteIdent(name)}${options?.cascade ? " CASCADE" : ""}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function renameIndex(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  newName: string,
): Promise<void> {
  const trimmed = validateIdentifier(newName, "Index");
  const sql = `ALTER INDEX ${quoteIdent(schema)}.${quoteIdent(name)} RENAME TO ${quoteIdent(trimmed)}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function createOrReplaceView(
  config: PostgresConfig,
  database: string,
  sql: string,
): Promise<void> {
  const trimmed = sql.trim().replace(/;+\s*$/g, "");
  if (
    !/^create\s+(or\s+replace\s+)?(materialized\s+)?view\b/i.test(trimmed)
  ) {
    throw new Error(
      "SQL must begin with CREATE [OR REPLACE] [MATERIALIZED] VIEW",
    );
  }
  await withClient(config, database, async (client) => {
    await client.query(trimmed);
  });
}

export async function getViewDefinition(
  config: PostgresConfig,
  database: string,
  schema: string,
  view: string
): Promise<string> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{ definition: string }>(
      `select pg_get_viewdef((quote_ident($1) || '.' || quote_ident($2))::regclass, true) as definition`,
      [schema, view]
    );
    return res.rows[0]?.definition ?? "";
  });
}

/**
 * Synthesizes a CREATE TABLE statement from columns + constraints + indexes.
 * Not byte-identical with pg_dump, but readable and copy-pastable.
 */
export async function getTableDDL(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string
): Promise<string> {
  const [columns, constraints, indexes] = await Promise.all([
    listColumns(config, database, schema, table),
    listConstraints(config, database, schema, table),
    listIndexes(config, database, schema, table),
  ]);

  const colLines = columns.map((c) => {
    const parts = [quoteIdent(c.name), c.dataType];
    if (!c.isNullable) parts.push("NOT NULL");
    if (c.default) parts.push(`DEFAULT ${c.default}`);
    return "  " + parts.join(" ");
  });

  const constraintLines = constraints.map(
    (c) => `  CONSTRAINT ${quoteIdent(c.name)} ${c.definition}`
  );

  const create = `CREATE TABLE ${tableIdent(schema, table)} (\n${[...colLines, ...constraintLines].join(",\n")}\n);`;

  const indexLines = indexes
    .filter((i) => !i.isPrimary)
    .map((i) => i.definition.endsWith(";") ? i.definition : i.definition + ";");

  return [create, ...indexLines].join("\n\n");
}

/** @internal — exported for tests. */
export function validateIdentifier(name: string, kind: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error(`${kind} name is required`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(
      `${kind} name must start with a letter or underscore and contain only letters, numbers, and underscores`,
    );
  }
  return trimmed;
}

// Reject `;` in free-form SQL fragments (types, default exprs, USING clauses,
// partial-index predicates, function arg signatures). `;` is the only character
// that lets a fragment escape to a second statement in pg's simple-query path.
/** @internal — exported for tests. */
export function requireNoStatementTerminator(value: string, fieldName: string): string {
  if (value.includes(";")) {
    throw new Error(`${fieldName} cannot contain ';'`);
  }
  return value;
}

export async function createDatabase(
  config: PostgresConfig,
  name: string,
  options?: { ifNotExists?: boolean; owner?: string; encoding?: string; template?: string },
): Promise<void> {
  const trimmed = validateIdentifier(name, "Database");
  const parts = [`CREATE DATABASE ${quoteIdent(trimmed)}`];
  if (options?.owner && options.owner.trim()) {
    parts.push(`OWNER ${quoteIdent(options.owner.trim())}`);
  }
  if (options?.template && options.template.trim()) {
    parts.push(`TEMPLATE ${quoteIdent(options.template.trim())}`);
  }
  if (options?.encoding && options.encoding.trim()) {
    parts.push(`ENCODING ${quoteIdent(options.encoding.trim())}`);
  }
  await withClient(config, undefined, async (client) => {
    await client.query(parts.join(" "));
  });
}

export async function dropDatabase(
  config: PostgresConfig,
  name: string,
  options?: { ifExists?: boolean; force?: boolean },
): Promise<void> {
  // Connect to a database that isn't the target. Default config DB usually works,
  // but if the caller asked to drop *that* one, fall back to "postgres".
  const fallback =
    config.database && config.database !== name ? config.database : "postgres";
  const sql = `DROP DATABASE ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(name)}${options?.force ? " WITH (FORCE)" : ""}`;
  const conn: PostgresConfig = { ...config, database: fallback };
  await withClient(conn, fallback, async (client) => {
    await client.query(sql);
  });
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

export async function createSchema(
  config: PostgresConfig,
  database: string,
  name: string,
  options?: { ifNotExists?: boolean }
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Schema name is required");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(
      "Schema name must start with a letter or underscore and contain only letters, numbers, and underscores"
    );
  }
  const sql = `CREATE SCHEMA ${options?.ifNotExists ? "IF NOT EXISTS " : ""}${quoteIdent(trimmed)}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropSchema(
  config: PostgresConfig,
  database: string,
  schema: string,
  options?: { cascade?: boolean; ifExists?: boolean }
): Promise<void> {
  const sql = `DROP SCHEMA ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(schema)}${options?.cascade ? " CASCADE" : " RESTRICT"}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropTable(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  options?: { cascade?: boolean; ifExists?: boolean }
): Promise<void> {
  const sql = `DROP TABLE ${options?.ifExists ? "IF EXISTS " : ""}${tableIdent(schema, table)}${options?.cascade ? " CASCADE" : " RESTRICT"}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropView(
  config: PostgresConfig,
  database: string,
  schema: string,
  view: string,
  options?: { cascade?: boolean; ifExists?: boolean; materialized?: boolean }
): Promise<void> {
  const kind = options?.materialized ? "MATERIALIZED VIEW" : "VIEW";
  const sql = `DROP ${kind} ${options?.ifExists ? "IF EXISTS " : ""}${tableIdent(schema, view)}${options?.cascade ? " CASCADE" : " RESTRICT"}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export type AlterTableOp =
  | { kind: "addColumn"; name: string; dataType: string; nullable: boolean; default?: string }
  | { kind: "dropColumn"; name: string; cascade?: boolean }
  | { kind: "renameColumn"; from: string; to: string }
  | { kind: "alterType"; name: string; dataType: string; using?: string }
  | { kind: "setDefault"; name: string; default: string }
  | { kind: "dropDefault"; name: string }
  | { kind: "setNotNull"; name: string }
  | { kind: "dropNotNull"; name: string };

function buildAlterClause(schema: string, table: string, op: AlterTableOp): string {
  const t = tableIdent(schema, table);
  switch (op.kind) {
    case "addColumn": {
      if (!op.name.trim()) throw new Error("Column name is required");
      if (!op.dataType.trim()) throw new Error("Column type is required");
      const dataType = requireNoStatementTerminator(op.dataType.trim(), "Column type");
      const parts = [`ALTER TABLE ${t} ADD COLUMN ${quoteIdent(op.name.trim())} ${dataType}`];
      if (!op.nullable) parts.push("NOT NULL");
      if (op.default && op.default.trim()) {
        const def = requireNoStatementTerminator(op.default.trim(), "Default expression");
        parts.push(`DEFAULT ${def}`);
      }
      return parts.join(" ");
    }
    case "dropColumn":
      return `ALTER TABLE ${t} DROP COLUMN ${quoteIdent(op.name)}${op.cascade ? " CASCADE" : ""}`;
    case "renameColumn":
      if (!op.to.trim()) throw new Error("New column name is required");
      return `ALTER TABLE ${t} RENAME COLUMN ${quoteIdent(op.from)} TO ${quoteIdent(op.to.trim())}`;
    case "alterType": {
      if (!op.dataType.trim()) throw new Error("New type is required");
      const dataType = requireNoStatementTerminator(op.dataType.trim(), "Column type");
      const using =
        op.using && op.using.trim()
          ? ` USING ${requireNoStatementTerminator(op.using.trim(), "USING expression")}`
          : "";
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} TYPE ${dataType}${using}`;
    }
    case "setDefault": {
      if (!op.default.trim()) throw new Error("Default expression is required");
      const def = requireNoStatementTerminator(op.default.trim(), "Default expression");
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} SET DEFAULT ${def}`;
    }
    case "dropDefault":
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} DROP DEFAULT`;
    case "setNotNull":
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} SET NOT NULL`;
    case "dropNotNull":
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} DROP NOT NULL`;
  }
}

export async function alterTable(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  ops: AlterTableOp[]
): Promise<{ statements: string[] }> {
  if (ops.length === 0) throw new Error("No changes to apply");
  const statements = ops.map((op) => buildAlterClause(schema, table, op));
  await withClient(config, database, async (client) => {
    await client.query("BEGIN");
    try {
      for (const stmt of statements) {
        await client.query(stmt);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  });
  return { statements };
}

export interface QueryResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

// ─── EXPLAIN ─────────────────────────────────────────────────────────────

export interface ExplainResult {
  /** Whole JSON tree returned by `EXPLAIN (..., FORMAT JSON)`. */
  plan: ExplainPlanRoot;
  /** Wall-clock time it took for us to run the EXPLAIN itself. */
  durationMs: number;
  /** Modified planner settings (Postgres 12+ via SETTINGS option). */
  settings?: Record<string, string>;
}

export interface ExplainPlanRoot {
  Plan: ExplainPlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
  Triggers?: unknown[];
  Settings?: Record<string, string>;
  JIT?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ExplainPlanNode {
  "Node Type": string;
  "Parallel Aware"?: boolean;
  "Async Capable"?: boolean;
  "Startup Cost"?: number;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  "Plan Width"?: number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  "Rows Removed by Join Filter"?: number;
  "Relation Name"?: string;
  "Schema"?: string;
  "Alias"?: string;
  "Index Name"?: string;
  "Filter"?: string;
  "Index Cond"?: string;
  "Hash Cond"?: string;
  "Join Type"?: string;
  "Strategy"?: string;
  "Sort Method"?: string;
  "Sort Space Used"?: number;
  "Sort Space Type"?: string;
  "Sort Key"?: string[];
  "Hash Buckets"?: number;
  "Hash Batches"?: number;
  "Original Hash Batches"?: number;
  "Peak Memory Usage"?: number;
  "Heap Fetches"?: number;
  /** Shared blocks */
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Shared Dirtied Blocks"?: number;
  "Shared Written Blocks"?: number;
  /** Local blocks (temp tables) */
  "Local Hit Blocks"?: number;
  "Local Read Blocks"?: number;
  "Local Dirtied Blocks"?: number;
  "Local Written Blocks"?: number;
  /** Temp (work_mem spill) */
  "Temp Read Blocks"?: number;
  "Temp Written Blocks"?: number;
  /** Children */
  Plans?: ExplainPlanNode[];
  [k: string]: unknown;
}

/**
 * Run EXPLAIN for the user's SQL and return the parsed JSON plan tree.
 *
 * When `analyze=true` the user's statement *actually executes*, so we wrap
 * it in `BEGIN; ... ROLLBACK;` to make write queries safe. PostgreSQL
 * EXPLAIN ANALYZE on an INSERT/UPDATE/DELETE will persist the change
 * without this wrapper — this is the standard Postgres safety dance.
 *
 * The SQL itself is the user's free-form text, intentionally unrestricted
 * (same contract as `runQuery`).
 */
export async function explainQuery(
  config: PostgresConfig,
  database: string,
  sql: string,
  options: { analyze?: boolean; verbose?: boolean; buffers?: boolean } = {},
): Promise<ExplainResult> {
  const analyze = options.analyze ?? true;
  const verbose = options.verbose ?? true;
  const buffers = options.buffers ?? analyze;
  // WAL and SETTINGS were added in PG13 and PG12 respectively. The driver
  // we're targeting is modern; if someone connects to an older server
  // these options will error and we degrade by retrying once without them.
  const optionTokens: string[] = [
    analyze ? "ANALYZE true" : null,
    "FORMAT JSON",
    verbose ? "VERBOSE true" : null,
    buffers ? "BUFFERS true" : null,
    analyze ? "WAL true" : null,
    "SETTINGS true",
  ].filter(Boolean) as string[];
  const optionsClause = `(${optionTokens.join(", ")})`;

  return withClient(config, database, async (client) => {
    const start = Date.now();
    if (analyze) {
      await client.query("BEGIN");
    }
    try {
      let res;
      try {
        res = await client.query<{ "QUERY PLAN": ExplainPlanRoot[] }>(
          `EXPLAIN ${optionsClause} ${sql}`,
        );
      } catch (err) {
        // Retry once with the conservative option set (no WAL, no SETTINGS).
        if (analyze) await client.query("ROLLBACK");
        if (analyze) await client.query("BEGIN");
        const fallback = analyze
          ? "(ANALYZE true, FORMAT JSON, VERBOSE true, BUFFERS true)"
          : "(FORMAT JSON, VERBOSE true)";
        try {
          res = await client.query<{ "QUERY PLAN": ExplainPlanRoot[] }>(
            `EXPLAIN ${fallback} ${sql}`,
          );
        } catch {
          throw err;
        }
      }
      const root = res.rows[0]?.["QUERY PLAN"]?.[0];
      if (!root) throw new Error("EXPLAIN returned an empty plan");
      return {
        plan: root,
        durationMs: Date.now() - start,
        settings: root.Settings,
      };
    } finally {
      if (analyze) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    }
  });
}

export async function runQuery(
  config: PostgresConfig,
  database: string,
  sql: string
): Promise<QueryResult> {
  return withClient(config, database, async (client) => {
    const start = Date.now();
    const res = await client.query({ text: sql, rowMode: "array" });
    return {
      fields: res.fields.map((f) => f.name),
      rows: res.rows as unknown[][],
      rowCount: res.rowCount ?? res.rows.length,
      durationMs: Date.now() - start,
    };
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

const TYPE_NAMES: Record<number, string> = {
  16: "bool",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  700: "float4",
  701: "float8",
  1043: "varchar",
  1082: "date",
  1114: "timestamp",
  1184: "timestamptz",
  2950: "uuid",
  3802: "jsonb",
  114: "json",
};

function pgTypeName(oid: number): string {
  return TYPE_NAMES[oid] || `oid:${oid}`;
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

// ─── Extension manager ────────────────────────────────────────────────────

export interface InstalledExtension {
  name: string;
  schema: string;
  installedVersion: string;
  defaultVersion: string | null;
  /** True when installedVersion !== defaultVersion. */
  updateAvailable: boolean;
  comment: string | null;
}

export interface AvailableExtension {
  name: string;
  defaultVersion: string | null;
  comment: string | null;
}

export interface ExtensionsListing {
  installed: InstalledExtension[];
  available: AvailableExtension[];
}

export async function listExtensions(
  config: PostgresConfig,
  database: string,
): Promise<ExtensionsListing> {
  return withClient(config, database, async (client) => {
    const [installed, available] = await Promise.all([
      client.query<{
        name: string;
        schema: string;
        installed_version: string;
        default_version: string | null;
        comment: string | null;
      }>(
        `select e.extname as name,
                n.nspname as schema,
                e.extversion as installed_version,
                a.default_version,
                a.comment
         from pg_extension e
         join pg_namespace n on n.oid = e.extnamespace
         left join pg_available_extensions a on a.name = e.extname
         order by e.extname`,
      ),
      client.query<{
        name: string;
        default_version: string | null;
        comment: string | null;
      }>(
        `select name, default_version, comment
         from pg_available_extensions
         where installed_version is null
         order by name`,
      ),
    ]);

    return {
      installed: installed.rows.map((r) => ({
        name: r.name,
        schema: r.schema,
        installedVersion: r.installed_version,
        defaultVersion: r.default_version,
        updateAvailable:
          r.default_version != null &&
          r.default_version !== r.installed_version,
        comment: r.comment,
      })),
      available: available.rows.map((r) => ({
        name: r.name,
        defaultVersion: r.default_version,
        comment: r.comment,
      })),
    };
  });
}

export async function createExtension(
  config: PostgresConfig,
  database: string,
  name: string,
  opts: { cascade?: boolean; schema?: string } = {},
): Promise<void> {
  validateIdentifier(name, "extension");
  if (opts.schema) validateIdentifier(opts.schema, "schema");
  await withClient(config, database, async (client) => {
    const parts = [`create extension if not exists ${quoteIdent(name)}`];
    if (opts.schema) parts.push(`schema ${quoteIdent(opts.schema)}`);
    if (opts.cascade) parts.push("cascade");
    await client.query(parts.join(" "));
  });
}

export async function dropExtension(
  config: PostgresConfig,
  database: string,
  name: string,
  opts: { cascade?: boolean } = {},
): Promise<void> {
  validateIdentifier(name, "extension");
  await withClient(config, database, async (client) => {
    const sql = `drop extension ${quoteIdent(name)}${opts.cascade ? " cascade" : ""}`;
    await client.query(sql);
  });
}

export async function updateExtension(
  config: PostgresConfig,
  database: string,
  name: string,
): Promise<void> {
  validateIdentifier(name, "extension");
  await withClient(config, database, async (client) => {
    await client.query(`alter extension ${quoteIdent(name)} update`);
  });
}
