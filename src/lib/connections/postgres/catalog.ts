/**
 * Postgres driver — read-only catalog introspection (databases, schemas,
 * tables, columns, indexes, constraints, foreign keys, functions,
 * sequences).
 */
import type { PostgresConfig } from "../types";
import { withClient } from "./client";
import { quoteIdent } from "./sql";
import { tableIdent } from "./internal";

export interface DatabaseInfo {
  name: string;
  owner: string;
  encoding: string;
  size: number;
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

/**
 * Bulk-list every table/view in a schema with their columns. Used to feed the
 * SQL editor's autocomplete in one round-trip instead of N per-table calls.
 * Values are parameterized; schema/table/column names are returned raw and
 * the caller (lang-sql) treats them as plain strings.
 */
export async function listSchemaColumns(
  config: PostgresConfig,
  database: string,
  schema: string,
): Promise<Array<{ name: string; columns: string[] }>> {
  return withClient(config, database, async (client) => {
    const res = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [schema],
    );
    const map = new Map<string, string[]>();
    for (const row of res.rows) {
      const arr = map.get(row.table_name) ?? [];
      arr.push(row.column_name);
      map.set(row.table_name, arr);
    }
    return [...map.entries()].map(([name, columns]) => ({ name, columns }));
  });
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
  /** Bytes on disk. */
  sizeBytes: number;
  /** Number of index scans since stats reset. */
  scans: number;
  /** Tuples returned by index scans. */
  tuplesRead: number;
  /** Tuples fetched via index scans (rows actually pulled from heap). */
  tuplesFetched: number;
  /** True when scans=0 AND not unique/primary — safe to consider for drop. */
  unused: boolean;
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
      size_bytes: string;
      scans: string;
      tuples_read: string;
      tuples_fetched: string;
    }>(
      `select i.indexname as name,
              i.indexdef as definition,
              x.indisunique as is_unique,
              x.indisprimary as is_primary,
              pg_relation_size(c.oid)::text as size_bytes,
              coalesce(s.idx_scan, 0)::text as scans,
              coalesce(s.idx_tup_read, 0)::text as tuples_read,
              coalesce(s.idx_tup_fetch, 0)::text as tuples_fetched
       from pg_indexes i
       join pg_class c on c.relname = i.indexname
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = i.schemaname
       join pg_index x on x.indexrelid = c.oid
       left join pg_stat_user_indexes s on s.indexrelid = c.oid
       where i.schemaname = $1 and i.tablename = $2
       order by i.indexname`,
      [schema, table]
    );
    return res.rows.map((r) => {
      const scans = Number(r.scans) || 0;
      return {
        name: r.name,
        definition: r.definition,
        isUnique: r.is_unique,
        isPrimary: r.is_primary,
        sizeBytes: Number(r.size_bytes) || 0,
        scans,
        tuplesRead: Number(r.tuples_read) || 0,
        tuplesFetched: Number(r.tuples_fetched) || 0,
        unused: scans === 0 && !r.is_unique && !r.is_primary,
      };
    });
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

  // Skip indexes that back a constraint we already emitted inline. A PRIMARY
  // KEY or UNIQUE constraint auto-creates an index of the same name, so
  // emitting `CREATE [UNIQUE] INDEX <name>` again would fail with
  // "relation <name> already exists" on restore.
  const constraintNames = new Set(constraints.map((c) => c.name));
  const indexLines = indexes
    .filter((i) => !i.isPrimary && !constraintNames.has(i.name))
    .map((i) => (i.definition.endsWith(";") ? i.definition : i.definition + ";"));

  return [create, ...indexLines].join("\n\n");
}

