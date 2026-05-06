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
              ), false) as is_primary_key
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
                  select attname
                  from unnest(c.conkey) k
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
                  order by array_position(c.conkey, k)
                ) as columns,
                array(
                  select attname
                  from unnest(c.confkey) k
                  join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k
                  order by array_position(c.confkey, k)
                ) as ref_columns,
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
      columns: r.columns,
      refSchema: r.ref_schema,
      refTable: r.ref_table,
      refColumns: r.ref_columns,
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
    const parts = [quoteIdent(c.name.trim()), c.dataType.trim()];
    if (!c.nullable) parts.push("NOT NULL");
    if (c.default && c.default.trim()) {
      parts.push(`DEFAULT ${c.default.trim()}`);
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
