import type { Connection, RowDataPacket, ConnectionOptions } from "mysql2/promise"; // type-only — erased at build, safe when mysql2 absent
import type { MysqlConfig } from "./types";
import { DriverNotInstalledError } from "@/techs/contract";

let _mysql2Mod: typeof import("mysql2/promise") | null = null;
async function getMysql2(): Promise<typeof import("mysql2/promise")> {
  try {
    return (_mysql2Mod ??= await import("mysql2/promise"));
  } catch {
    throw new DriverNotInstalledError("mysql", "mysql2");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MySQL driver
//
// Mirrors the shape of `postgres.ts` but adapted to MySQL semantics:
//   • MySQL has no schema layer — a *database* is the namespace, so every
//     object path is `<database>.<table>` (no schema segment).
//   • Metadata comes from `information_schema` + `SHOW` statements.
//   • mysql2's promise API returns `[rows, fields]` tuples.
//
// Like the Postgres driver, `withConn` opens a fresh connection per call. The
// intended-but-deferred architecture is a cached pool per connection record;
// don't refactor it in-flight (see AGENTS.md "Known design gap").
// ─────────────────────────────────────────────────────────────────────────────

function buildConnConfig(
  config: MysqlConfig,
  databaseOverride?: string,
  opts?: { multipleStatements?: boolean }
): ConnectionOptions {
  const database = databaseOverride ?? config.database;
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: database || undefined,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 6000,
    multipleStatements: opts?.multipleStatements ?? false,
    // Keep large integers as strings so BIGINT / counts don't lose precision,
    // and decimals stay exact. The UI renders everything as text anyway.
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    dateStrings: true,
  };
}

async function withConn<T>(
  config: MysqlConfig,
  database: string | undefined,
  fn: (conn: Connection) => Promise<T>,
  opts?: { multipleStatements?: boolean }
): Promise<T> {
  const { createConnection } = await getMysql2();
  const conn = await createConnection(
    buildConnConfig(config, database, opts)
  );
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

async function query<T extends RowDataPacket = RowDataPacket>(
  conn: Connection,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const [rows] = await conn.query<T[]>(sql, params);
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Identifier / fragment safety (mirrors postgres.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Backtick-quote an identifier and double any internal backticks. */
export function quoteIdent(name: string): string {
  return "`" + String(name).replace(/`/g, "``") + "`";
}

/** Fully-qualified `db`.`table`. */
export function quoteQualified(database: string, name: string): string {
  return `${quoteIdent(database)}.${quoteIdent(name)}`;
}

export function validateIdentifier(name: string, kind: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(
      `Invalid ${kind} name "${name}". Use letters, digits, _ and $, starting with a letter or underscore.`
    );
  }
  return name;
}

/**
 * Reject the statement terminator in free-form SQL fragments (column types,
 * DEFAULT expressions, etc.). `;` is what lets a second statement piggyback
 * on the simple-query path, so blocking it is the SQLi guard for these fields.
 */
export function requireNoStatementTerminator(
  value: string,
  fieldName: string
): string {
  if (value.includes(";")) {
    throw new Error(`${fieldName} must not contain ";".`);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe + overview
// ─────────────────────────────────────────────────────────────────────────────

export interface MysqlProbe {
  serverVersion: string;
  currentDatabase: string;
  currentUser: string;
}

export async function probeMysql(config: MysqlConfig): Promise<MysqlProbe> {
  return withConn(config, undefined, async (conn) => {
    const rows = await query<
      RowDataPacket & { version: string; db: string | null; user: string }
    >(
      conn,
      "select version() as version, database() as db, current_user() as user"
    );
    const r = rows[0];
    return {
      serverVersion: r.version,
      currentDatabase: r.db ?? "",
      currentUser: r.user,
    };
  });
}

export interface ServerOverview {
  serverVersion: string;
  currentUser: string;
  currentDatabase: string;
  uptimeSeconds: number;
  maxConnections: number;
  threadsConnected: number;
  threadsRunning: number;
  /** Cumulative queries since start. */
  totalQueries: number;
  /** Approximate queries-per-second over the server's uptime. */
  queriesPerSecond: number;
  /** InnoDB buffer pool hit ratio 0..1 (0 when stats unavailable). */
  bufferPoolHitRatio: number;
  totalDatabasesSize: number;
  databases: Array<{
    name: string;
    charset: string;
    collation: string;
    tableCount: number;
    size: number;
  }>;
}

export async function getServerOverview(
  config: MysqlConfig
): Promise<ServerOverview> {
  return withConn(config, undefined, async (conn) => {
    const [head, statusRows, varRows, dbs] = await Promise.all([
      query<
        RowDataPacket & { version: string; db: string | null; user: string }
      >(
        conn,
        "select version() as version, database() as db, current_user() as user"
      ),
      query<RowDataPacket & { Variable_name: string; Value: string }>(
        conn,
        `show global status where Variable_name in
           ('Uptime','Threads_connected','Threads_running','Queries',
            'Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads')`
      ),
      query<RowDataPacket & { Variable_name: string; Value: string }>(
        conn,
        "show variables where Variable_name = 'max_connections'"
      ),
      query<
        RowDataPacket & {
          name: string;
          charset: string;
          collation: string;
          table_count: string;
          size: string;
        }
      >(
        conn,
        `select s.SCHEMA_NAME as name,
                s.DEFAULT_CHARACTER_SET_NAME as charset,
                s.DEFAULT_COLLATION_NAME as collation,
                coalesce(t.cnt, 0) as table_count,
                coalesce(t.sz, 0) as size
           from information_schema.SCHEMATA s
           left join (
             select TABLE_SCHEMA,
                    count(*) as cnt,
                    sum(coalesce(DATA_LENGTH,0) + coalesce(INDEX_LENGTH,0)) as sz
               from information_schema.TABLES
              group by TABLE_SCHEMA
           ) t on t.TABLE_SCHEMA = s.SCHEMA_NAME
          order by size desc, name asc`
      ),
    ]);

    const status = new Map(statusRows.map((r) => [r.Variable_name, r.Value]));
    const num = (k: string) => Number(status.get(k) ?? 0);
    const uptime = num("Uptime");
    const totalQueries = num("Queries");
    const reads = num("Innodb_buffer_pool_reads");
    const reqs = num("Innodb_buffer_pool_read_requests");
    const hit = reqs > 0 ? Math.max(0, (reqs - reads) / reqs) : 0;

    const databases = dbs.map((r) => ({
      name: r.name,
      charset: r.charset,
      collation: r.collation,
      tableCount: Number(r.table_count),
      size: Number(r.size),
    }));

    return {
      serverVersion: head[0].version,
      currentUser: head[0].user,
      currentDatabase: head[0].db ?? "",
      uptimeSeconds: uptime,
      maxConnections: Number(varRows[0]?.Value ?? 0),
      threadsConnected: num("Threads_connected"),
      threadsRunning: num("Threads_running"),
      totalQueries,
      queriesPerSecond: uptime > 0 ? totalQueries / uptime : 0,
      bufferPoolHitRatio: hit,
      totalDatabasesSize: databases.reduce((s, d) => s + d.size, 0),
      databases,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Databases
// ─────────────────────────────────────────────────────────────────────────────

/** Internal databases that are hidden from the tree by default. */
const SYSTEM_DATABASES = new Set([
  "information_schema",
  "performance_schema",
  "mysql",
  "sys",
]);

export interface DatabaseInfo {
  name: string;
  charset: string;
  collation: string;
  system: boolean;
}

export async function listDatabases(
  config: MysqlConfig
): Promise<DatabaseInfo[]> {
  return withConn(config, undefined, async (conn) => {
    const rows = await query<
      RowDataPacket & { name: string; charset: string; collation: string }
    >(
      conn,
      `select SCHEMA_NAME as name,
              DEFAULT_CHARACTER_SET_NAME as charset,
              DEFAULT_COLLATION_NAME as collation
         from information_schema.SCHEMATA
        order by SCHEMA_NAME`
    );
    return rows.map((r) => ({
      name: r.name,
      charset: r.charset,
      collation: r.collation,
      system: SYSTEM_DATABASES.has(r.name.toLowerCase()),
    }));
  });
}

export async function createDatabase(
  config: MysqlConfig,
  name: string,
  opts?: { charset?: string; collation?: string }
): Promise<void> {
  validateIdentifier(name, "database");
  let sql = `create database ${quoteIdent(name)}`;
  if (opts?.charset) {
    requireNoStatementTerminator(opts.charset, "charset");
    sql += ` character set ${quoteIdent(opts.charset)}`;
  }
  if (opts?.collation) {
    requireNoStatementTerminator(opts.collation, "collation");
    sql += ` collate ${quoteIdent(opts.collation)}`;
  }
  await withConn(config, undefined, (conn) => query(conn, sql));
}

export async function dropDatabase(
  config: MysqlConfig,
  name: string
): Promise<void> {
  validateIdentifier(name, "database");
  await withConn(config, undefined, (conn) =>
    query(conn, `drop database ${quoteIdent(name)}`)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tables / views
// ─────────────────────────────────────────────────────────────────────────────

export interface TableListing {
  name: string;
  kind: "table" | "view";
  engine: string | null;
  rowEstimate: number;
  totalSize: number;
  comment: string;
}

export async function listTables(
  config: MysqlConfig,
  database: string
): Promise<TableListing[]> {
  return withConn(config, database, async (conn) => {
    const rows = await query<
      RowDataPacket & {
        name: string;
        type: string;
        engine: string | null;
        rows: string | null;
        data_length: string | null;
        index_length: string | null;
        comment: string | null;
      }
    >(
      conn,
      `select TABLE_NAME as name,
              TABLE_TYPE as type,
              ENGINE as engine,
              TABLE_ROWS as \`rows\`,
              DATA_LENGTH as data_length,
              INDEX_LENGTH as index_length,
              TABLE_COMMENT as comment
         from information_schema.TABLES
        where TABLE_SCHEMA = ?
        order by TABLE_NAME`,
      [database]
    );
    return rows.map((r) => ({
      name: r.name,
      kind: r.type === "VIEW" ? ("view" as const) : ("table" as const),
      engine: r.engine,
      rowEstimate: Number(r.rows ?? 0),
      totalSize: Number(r.data_length ?? 0) + Number(r.index_length ?? 0),
      comment: r.comment ?? "",
    }));
  });
}

export interface TopTable {
  database: string;
  name: string;
  engine: string | null;
  rowEstimate: number;
  totalSize: number;
  indexSize: number;
}

export async function getTopTables(
  config: MysqlConfig,
  limit: number = 10
): Promise<TopTable[]> {
  return withConn(config, undefined, async (conn) => {
    const rows = await query<
      RowDataPacket & {
        database: string;
        name: string;
        engine: string | null;
        rows: string | null;
        data_length: string | null;
        index_length: string | null;
      }
    >(
      conn,
      `select TABLE_SCHEMA as \`database\`,
              TABLE_NAME as name,
              ENGINE as engine,
              TABLE_ROWS as \`rows\`,
              DATA_LENGTH as data_length,
              INDEX_LENGTH as index_length
         from information_schema.TABLES
        where TABLE_TYPE = 'BASE TABLE'
          and TABLE_SCHEMA not in ('information_schema','performance_schema','mysql','sys')
        order by (coalesce(DATA_LENGTH,0) + coalesce(INDEX_LENGTH,0)) desc
        limit ?`,
      [limit]
    );
    return rows.map((r) => ({
      database: r.database,
      name: r.name,
      engine: r.engine,
      rowEstimate: Number(r.rows ?? 0),
      totalSize: Number(r.data_length ?? 0) + Number(r.index_length ?? 0),
      indexSize: Number(r.index_length ?? 0),
    }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  dataType: string;
  /** Full COLUMN_TYPE, e.g. `varchar(255)`, `int unsigned`. */
  columnType: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  extra: string;
  comment: string;
  ordinal: number;
}

export async function listColumns(
  config: MysqlConfig,
  database: string,
  table: string
): Promise<ColumnInfo[]> {
  return withConn(config, database, async (conn) => {
    const rows = await query<
      RowDataPacket & {
        name: string;
        data_type: string;
        column_type: string;
        is_nullable: string;
        column_default: string | null;
        column_key: string;
        extra: string;
        comment: string;
        ordinal: number;
      }
    >(
      conn,
      `select COLUMN_NAME as name,
              DATA_TYPE as data_type,
              COLUMN_TYPE as column_type,
              IS_NULLABLE as is_nullable,
              COLUMN_DEFAULT as column_default,
              COLUMN_KEY as column_key,
              EXTRA as extra,
              COLUMN_COMMENT as comment,
              ORDINAL_POSITION as ordinal
         from information_schema.COLUMNS
        where TABLE_SCHEMA = ? and TABLE_NAME = ?
        order by ORDINAL_POSITION`,
      [database, table]
    );
    return rows.map((r) => ({
      name: r.name,
      dataType: r.data_type,
      columnType: r.column_type,
      nullable: r.is_nullable === "YES",
      default: r.column_default,
      isPrimaryKey: r.column_key === "PRI",
      extra: r.extra ?? "",
      comment: r.comment ?? "",
      ordinal: Number(r.ordinal),
    }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexInfo {
  name: string;
  unique: boolean;
  primary: boolean;
  type: string;
  columns: string[];
}

export async function listIndexes(
  config: MysqlConfig,
  database: string,
  table: string
): Promise<IndexInfo[]> {
  return withConn(config, database, async (conn) => {
    const rows = await query<
      RowDataPacket & {
        index_name: string;
        non_unique: number;
        index_type: string;
        column_name: string;
        seq: number;
      }
    >(
      conn,
      `select INDEX_NAME as index_name,
              NON_UNIQUE as non_unique,
              INDEX_TYPE as index_type,
              COLUMN_NAME as column_name,
              SEQ_IN_INDEX as seq
         from information_schema.STATISTICS
        where TABLE_SCHEMA = ? and TABLE_NAME = ?
        order by INDEX_NAME, SEQ_IN_INDEX`,
      [database, table]
    );
    const byName = new Map<string, IndexInfo>();
    for (const r of rows) {
      let idx = byName.get(r.index_name);
      if (!idx) {
        idx = {
          name: r.index_name,
          unique: r.non_unique === 0,
          primary: r.index_name === "PRIMARY",
          type: r.index_type,
          columns: [],
        };
        byName.set(r.index_name, idx);
      }
      idx.columns.push(r.column_name);
    }
    return [...byName.values()];
  });
}

export interface CreateIndexInput {
  name: string;
  columns: string[];
  unique: boolean;
}

export async function createIndex(
  config: MysqlConfig,
  database: string,
  table: string,
  input: CreateIndexInput
): Promise<void> {
  validateIdentifier(input.name, "index");
  if (!input.columns.length) throw new Error("Select at least one column.");
  const cols = input.columns
    .map((c) => quoteIdent(validateIdentifier(c, "column")))
    .join(", ");
  const unique = input.unique ? "unique " : "";
  await withConn(config, database, (conn) =>
    query(
      conn,
      `create ${unique}index ${quoteIdent(input.name)} on ${quoteIdent(
        table
      )} (${cols})`
    )
  );
}

export async function dropIndex(
  config: MysqlConfig,
  database: string,
  table: string,
  name: string
): Promise<void> {
  validateIdentifier(name, "index");
  await withConn(config, database, (conn) =>
    query(conn, `drop index ${quoteIdent(name)} on ${quoteIdent(table)}`)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DDL
// ─────────────────────────────────────────────────────────────────────────────

export async function getTableDDL(
  config: MysqlConfig,
  database: string,
  table: string
): Promise<string> {
  return withConn(config, database, async (conn) => {
    const rows = await query<RowDataPacket & Record<string, string>>(
      conn,
      `show create table ${quoteIdent(table)}`
    );
    const row = rows[0];
    // The column is "Create Table" for tables, "Create View" for views.
    return row?.["Create Table"] ?? row?.["Create View"] ?? "";
  });
}

export interface CreateTableColumnInput {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  autoIncrement?: boolean;
  primaryKey?: boolean;
}

export interface CreateTableInput {
  name: string;
  columns: CreateTableColumnInput[];
  engine?: string;
  comment?: string;
}

export async function createTable(
  config: MysqlConfig,
  database: string,
  input: CreateTableInput
): Promise<void> {
  validateIdentifier(input.name, "table");
  if (!input.columns.length) throw new Error("Add at least one column.");

  const pkCols: string[] = [];
  const defs = input.columns.map((c) => {
    validateIdentifier(c.name, "column");
    requireNoStatementTerminator(c.type, "column type");
    let def = `${quoteIdent(c.name)} ${c.type}`;
    def += c.nullable ? " null" : " not null";
    if (c.autoIncrement) def += " auto_increment";
    if (c.default != null && c.default !== "") {
      requireNoStatementTerminator(c.default, "default");
      def += ` default ${c.default}`;
    }
    if (c.primaryKey) pkCols.push(quoteIdent(c.name));
    return def;
  });
  if (pkCols.length) defs.push(`primary key (${pkCols.join(", ")})`);

  let sql = `create table ${quoteIdent(input.name)} (\n  ${defs.join(
    ",\n  "
  )}\n)`;
  if (input.engine) {
    requireNoStatementTerminator(input.engine, "engine");
    sql += ` engine=${input.engine}`;
  }
  if (input.comment) {
    sql += ` comment=${escapeString(input.comment)}`;
  }
  await withConn(config, database, (conn) => query(conn, sql));
}

export async function dropTable(
  config: MysqlConfig,
  database: string,
  table: string,
  kind: "table" | "view" = "table"
): Promise<void> {
  validateIdentifier(table, kind);
  const stmt = kind === "view" ? "drop view" : "drop table";
  await withConn(config, database, (conn) =>
    query(conn, `${stmt} ${quoteIdent(table)}`)
  );
}

export async function truncateTable(
  config: MysqlConfig,
  database: string,
  table: string
): Promise<void> {
  validateIdentifier(table, "table");
  await withConn(config, database, (conn) =>
    query(conn, `truncate table ${quoteIdent(table)}`)
  );
}

/** Quote a string literal for the rare DDL spot that can't be parameterized. */
function escapeString(value: string): string {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
}

// ─────────────────────────────────────────────────────────────────────────────
// Table data + row CRUD
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnValue = string | number | boolean | null;

export interface TableData {
  columns: string[];
  rows: Record<string, ColumnValue>[];
  totalRows: number;
  primaryKey: string[];
}

export async function readTableData(
  config: MysqlConfig,
  database: string,
  table: string,
  opts: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir?: "asc" | "desc";
  } = {}
): Promise<TableData> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const offset = Math.max(opts.offset ?? 0, 0);
  return withConn(config, database, async (conn) => {
    const cols = await listColumns(config, database, table);
    const primaryKey = cols.filter((c) => c.isPrimaryKey).map((c) => c.name);

    let orderClause = "";
    if (opts.orderBy) {
      validateIdentifier(opts.orderBy, "column");
      const dir = opts.orderDir === "desc" ? "desc" : "asc";
      orderClause = ` order by ${quoteIdent(opts.orderBy)} ${dir}`;
    }

    const rows = await query<RowDataPacket & Record<string, ColumnValue>>(
      conn,
      `select * from ${quoteIdent(table)}${orderClause} limit ? offset ?`,
      [limit, offset]
    );
    const countRows = await query<RowDataPacket & { c: string }>(
      conn,
      `select count(*) as c from ${quoteIdent(table)}`
    );

    return {
      columns: cols.map((c) => c.name),
      rows: rows.map((r) => ({ ...r })),
      totalRows: Number(countRows[0]?.c ?? 0),
      primaryKey,
    };
  });
}

export async function insertRow(
  config: MysqlConfig,
  database: string,
  table: string,
  values: Record<string, ColumnValue>
): Promise<void> {
  const keys = Object.keys(values);
  if (!keys.length) throw new Error("No values supplied.");
  const cols = keys.map((k) => quoteIdent(validateIdentifier(k, "column")));
  const placeholders = keys.map(() => "?").join(", ");
  await withConn(config, database, (conn) =>
    query(
      conn,
      `insert into ${quoteIdent(table)} (${cols.join(
        ", "
      )}) values (${placeholders})`,
      keys.map((k) => values[k])
    )
  );
}

export async function updateRow(
  config: MysqlConfig,
  database: string,
  table: string,
  pk: Record<string, ColumnValue>,
  values: Record<string, ColumnValue>
): Promise<void> {
  const valKeys = Object.keys(values);
  const pkKeys = Object.keys(pk);
  if (!valKeys.length) throw new Error("No values to update.");
  if (!pkKeys.length) throw new Error("No primary key to target the row.");

  const setClause = valKeys
    .map((k) => `${quoteIdent(validateIdentifier(k, "column"))} = ?`)
    .join(", ");
  const whereClause = pkKeys
    .map((k) => `${quoteIdent(validateIdentifier(k, "column"))} = ?`)
    .join(" and ");
  await withConn(config, database, (conn) =>
    query(
      conn,
      `update ${quoteIdent(table)} set ${setClause} where ${whereClause} limit 1`,
      [...valKeys.map((k) => values[k]), ...pkKeys.map((k) => pk[k])]
    )
  );
}

export async function deleteRow(
  config: MysqlConfig,
  database: string,
  table: string,
  pk: Record<string, ColumnValue>
): Promise<void> {
  const pkKeys = Object.keys(pk);
  if (!pkKeys.length) throw new Error("No primary key to target the row.");
  const whereClause = pkKeys
    .map((k) => `${quoteIdent(validateIdentifier(k, "column"))} = ?`)
    .join(" and ");
  await withConn(config, database, (conn) =>
    query(
      conn,
      `delete from ${quoteIdent(table)} where ${whereClause} limit 1`,
      pkKeys.map((k) => pk[k])
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Free-form query editor
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryResult {
  columns: string[];
  rows: Record<string, ColumnValue>[];
  rowCount: number;
  command: string;
  /** True when the rowset was capped (more rows exist than were returned). */
  truncated?: boolean;
}

export interface QueryStatementResult extends QueryResult {
  statement: string;
  durationMs: number;
}

export interface QueryStatementError {
  statement: string;
  error: string;
}

export interface MultiQueryResult {
  results: QueryStatementResult[];
  errors: QueryStatementError[];
}

/**
 * Split a SQL script into statements on top-level `;`, ignoring semicolons
 * inside single/double/backtick quotes and `--` / `#` / `/* *​/` comments.
 * Good enough for the editor's "run each statement, report per-statement"
 * behaviour (mirrors the Postgres splitter).
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment: -- … or # …
    if ((ch === "-" && next === "-") || ch === "#") {
      while (i < n && sql[i] !== "\n") buf += sql[i++];
      continue;
    }
    // Block comment
    if (ch === "/" && next === "*") {
      buf += ch;
      buf += next;
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) buf += sql[i++];
      if (i < n) {
        buf += sql[i++];
        buf += sql[i++];
      }
      continue;
    }
    // Quoted string / identifier
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      buf += ch;
      i++;
      while (i < n) {
        const c = sql[i];
        buf += c;
        i++;
        if (c === "\\" && quote !== "`") {
          // backslash escape (not valid inside backticks)
          if (i < n) {
            buf += sql[i];
            i++;
          }
          continue;
        }
        if (c === quote) {
          // doubled quote = escaped quote, stay in string
          if (sql[i] === quote) {
            buf += sql[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (ch === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function commandOf(sql: string): string {
  const m = sql.trimStart().match(/^[a-zA-Z]+/);
  return m ? m[0].toUpperCase() : "";
}

/** Editor row cap — matches the Postgres / SQL Server editors. */
const EDITOR_ROW_CAP = 1000;

// Minimal shape of mysql2's underlying (callback) connection + Query emitter,
// reached via the promise wrapper's `.connection`. mysql2 ships no usable
// types for the streaming event API, so we declare just what we use.
interface CoreQuery {
  on(ev: "fields", cb: (fields: { name: string }[] | undefined) => void): CoreQuery;
  on(ev: "result", cb: (row: unknown) => void): CoreQuery;
  on(ev: "end", cb: () => void): CoreQuery;
  on(ev: "error", cb: (err: Error) => void): CoreQuery;
}
interface CoreConn {
  query(sql: string): CoreQuery;
  destroy(): void;
}

/**
 * Run one statement in streaming mode, keeping at most `maxRows` rows. The
 * moment a result set produces one row past the cap we `destroy()` the
 * connection to stop the server mid-stream, instead of buffering the whole
 * result (mysql2 has no statement timeout, so a huge SELECT would otherwise
 * pull every row into memory). Because the connection is then dead, a truncated
 * statement ends the batch — `runQueryMulti` breaks after it.
 */
function runStatementBounded(
  conn: Connection,
  statement: string,
  maxRows: number,
): Promise<{
  columns: string[];
  rows: Record<string, ColumnValue>[];
  rowCount: number;
  truncated: boolean;
  isResultSet: boolean;
}> {
  const core = (conn as unknown as { connection: CoreConn }).connection;
  return new Promise((resolve, reject) => {
    const rows: Record<string, ColumnValue>[] = [];
    let columns: string[] = [];
    let isResultSet = false;
    let affectedRows = 0;
    let settled = false;
    const q = core.query(statement);
    // Writes emit 'fields' with `undefined`; result sets emit the field list.
    q.on("fields", (fields) => {
      if (fields) {
        isResultSet = true;
        columns = fields.map((f) => f.name);
      }
    });
    q.on("result", (row) => {
      if (settled) return;
      if (!isResultSet) {
        affectedRows = (row as { affectedRows?: number })?.affectedRows ?? 0;
        return;
      }
      if (rows.length < maxRows) {
        rows.push(row as Record<string, ColumnValue>);
      } else {
        settled = true;
        core.destroy(); // one row past the cap — stop the firehose
        resolve({ columns, rows, rowCount: rows.length, truncated: true, isResultSet });
      }
    });
    q.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    q.on("end", () => {
      if (settled) return;
      settled = true;
      resolve({
        columns: isResultSet ? columns : [],
        rows,
        rowCount: isResultSet ? rows.length : affectedRows,
        truncated: false,
        isResultSet,
      });
    });
  });
}

export async function runQueryMulti(
  config: MysqlConfig,
  database: string | undefined,
  sql: string
): Promise<MultiQueryResult> {
  const statements = splitSqlStatements(sql);
  const results: QueryStatementResult[] = [];
  const errors: QueryStatementError[] = [];

  await withConn(config, database, async (conn) => {
    for (const statement of statements) {
      const start = process.hrtime.bigint();
      try {
        const r = await runStatementBounded(conn, statement, EDITOR_ROW_CAP);
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        results.push({
          statement,
          durationMs,
          columns: r.columns,
          rows: r.rows,
          rowCount: r.rowCount,
          truncated: r.truncated,
          command: commandOf(statement),
        });
        // The connection was destroyed to stop the stream, so no further
        // statements can run on it — end the batch here.
        if (r.truncated) break;
      } catch (err) {
        errors.push({
          statement,
          error: err instanceof Error ? err.message : String(err),
        });
        // Stop at the first error — matches the editor's expectation that a
        // failed statement halts the batch.
        break;
      }
    }
  });

  return { results, errors };
}

export interface ReadOnlyResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

/**
 * Run a single read-only statement enforced by MySQL's READ ONLY transaction.
 * Blocks ';' (no multi-statement injection); writes are rejected by the engine
 * inside `START TRANSACTION READ ONLY`. Used by the AI `mysql_run_sql` tool.
 */
export async function runReadOnlyQuery(
  config: MysqlConfig,
  database: string,
  sql: string,
  maxRows = 1000,
): Promise<ReadOnlyResult> {
  const single = requireNoStatementTerminator(sql.trim().replace(/;+\s*$/g, ""), "Query");
  return withConn(config, database, async (conn) => {
    const start = Date.now();
    await conn.query("START TRANSACTION READ ONLY");
    try {
      const [rows, fields] = (await conn.query({ sql: single, rowsAsArray: true })) as unknown as [
        unknown[][],
        { name: string }[],
      ];
      const capped = (rows ?? []).slice(0, maxRows);
      return {
        fields: (fields ?? []).map((f) => f.name),
        rows: capped,
        rowCount: capped.length,
        durationMs: Date.now() - start,
      };
    } finally {
      await conn.query("ROLLBACK").catch(() => undefined);
    }
  });
}

export interface ExplainResult {
  rows: Record<string, ColumnValue>[];
  columns: string[];
}

export async function explainQuery(
  config: MysqlConfig,
  database: string | undefined,
  sql: string
): Promise<ExplainResult> {
  return withConn(config, database, async (conn) => {
    const rows = await query<RowDataPacket & Record<string, ColumnValue>>(
      conn,
      `explain format=traditional ${sql}`
    );
    return {
      rows,
      columns: rows.length ? Object.keys(rows[0]) : [],
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Process list (MySQL's "activity")
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessRow {
  id: number;
  user: string;
  host: string;
  db: string | null;
  command: string;
  time: number;
  state: string;
  info: string | null;
}

export async function listProcesses(
  config: MysqlConfig
): Promise<ProcessRow[]> {
  return withConn(config, undefined, async (conn) => {
    const rows = await query<
      RowDataPacket & {
        ID: string;
        USER: string;
        HOST: string;
        DB: string | null;
        COMMAND: string;
        TIME: string;
        STATE: string | null;
        INFO: string | null;
      }
    >(
      conn,
      `select ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO
         from information_schema.PROCESSLIST
        order by TIME desc`
    );
    return rows.map((r) => ({
      id: Number(r.ID),
      user: r.USER,
      host: r.HOST,
      db: r.DB,
      command: r.COMMAND,
      time: Number(r.TIME),
      state: r.STATE ?? "",
      info: r.INFO,
    }));
  });
}

export async function killProcess(
  config: MysqlConfig,
  processId: number
): Promise<void> {
  if (!Number.isInteger(processId)) throw new Error("Invalid process id.");
  // KILL doesn't accept placeholders; processId is validated as an integer.
  await withConn(config, undefined, (conn) =>
    query(conn, `kill ${processId}`)
  );
}
