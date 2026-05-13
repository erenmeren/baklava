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

function quoteIdent(name: string): string {
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

function validateIdentifier(name: string, kind: string): string {
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
function requireNoStatementTerminator(value: string, fieldName: string): string {
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
