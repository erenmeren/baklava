import { Pool, type PoolClient } from "pg";
import { BaklavaException, makeError } from "../errors.js";
import {
  type ColumnInfo,
  type ConnectionConfig,
  type FilterClause,
  type Plugin,
  type SchemaInfo,
  clampLimit,
} from "./types.js";

interface PgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  schema: string;
}

export interface PgHandle {
  pool: Pool;
  schema: string;
}

function readConfig(c: ConnectionConfig): PgConfig {
  const cfg = c.config as Record<string, unknown>;
  const requireString = (key: string): string => {
    const v = cfg[key];
    if (typeof v !== "string" || v.length === 0) {
      throw new BaklavaException(
        makeError({
          code: "E_CONNECTION_NOT_FOUND",
          what: `Postgres connection "${c.name}" is missing the "${key}" field.`,
          why: 'The Postgres plugin requires "host", "database", "user", and "password".',
          fix: `Add "${key}" to the connection config.`,
        })
      );
    }
    return v;
  };
  const port = typeof cfg.port === "number" ? cfg.port : 5432;
  const ssl = cfg.ssl === true;
  const schema = typeof cfg.schema === "string" && cfg.schema ? cfg.schema : "public";
  return {
    host: requireString("host"),
    port,
    database: requireString("database"),
    user: requireString("user"),
    password: requireString("password"),
    ssl,
    schema,
  };
}

/** Map Postgres native types (data_type from information_schema) to DuckDB types. */
function pgToDuckDb(dataType: string, udtName: string): string {
  const t = (dataType || "").toLowerCase();
  const u = (udtName || "").toLowerCase();
  if (u === "int2" || t === "smallint") return "SMALLINT";
  if (u === "int4" || t === "integer") return "INTEGER";
  if (u === "int8" || t === "bigint") return "BIGINT";
  if (u === "float4" || t === "real") return "FLOAT";
  if (u === "float8" || t === "double precision") return "DOUBLE";
  if (t.startsWith("numeric") || t.startsWith("decimal")) return "DECIMAL(38,10)";
  if (t === "boolean" || u === "bool") return "BOOLEAN";
  if (t === "uuid") return "VARCHAR";
  if (t === "json" || t === "jsonb") return "VARCHAR";
  if (t === "bytea") return "BLOB";
  if (t === "date") return "DATE";
  if (t === "time" || t === "time without time zone" || t === "time with time zone")
    return "TIME";
  if (t.startsWith("timestamp")) return "TIMESTAMP";
  if (t.includes("char") || t === "text") return "VARCHAR";
  return "VARCHAR";
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function compileWhere(
  clause: FilterClause | undefined,
  allowedColumns: Set<string>,
  paramIndex: { i: number },
  params: unknown[]
): string {
  if (!clause) return "";
  return compileClause(clause, allowedColumns, paramIndex, params);
}

function compileClause(
  clause: FilterClause,
  allowedColumns: Set<string>,
  paramIndex: { i: number },
  params: unknown[]
): string {
  if (clause.op === "and" || clause.op === "or") {
    const parts = clause.clauses
      .map((c) => compileClause(c, allowedColumns, paramIndex, params))
      .filter((s) => s.length > 0);
    if (parts.length === 0) return "";
    return `(${parts.join(` ${clause.op.toUpperCase()} `)})`;
  }
  const leaf = clause as Exclude<FilterClause, { op: "and" | "or" }>;
  if (!allowedColumns.has(leaf.column)) {
    throw new BaklavaException(
      makeError({
        code: "E_AI_PLAN_VALIDATION_FAILED",
        what: `Filter references column "${leaf.column}" which is not in the declared schema.`,
        why: "Plugins reject filters against undeclared columns to keep the security gate honest.",
        fix: "Update the AI plan to use only declared columns.",
      })
    );
  }
  const col = quoteIdent(leaf.column);
  const next = () => `$${paramIndex.i++}`;
  switch (leaf.op) {
    case "eq":
      if (leaf.value === null) return `${col} IS NULL`;
      params.push(leaf.value);
      return `${col} = ${next()}`;
    case "neq":
      if (leaf.value === null) return `${col} IS NOT NULL`;
      params.push(leaf.value);
      return `${col} != ${next()}`;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const opMap = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
      params.push(leaf.value);
      return `${col} ${opMap[leaf.op]} ${next()}`;
    }
    case "in":
    case "nin": {
      if (leaf.values.length === 0) return leaf.op === "in" ? "FALSE" : "TRUE";
      const placeholders = leaf.values.map(() => next()).join(",");
      for (const v of leaf.values) params.push(v);
      return `${col} ${leaf.op === "in" ? "IN" : "NOT IN"} (${placeholders})`;
    }
  }
}

export const postgresPlugin: Plugin<PgHandle> = {
  name: "postgres",

  validateConfig(c) {
    readConfig(c);
  },

  async connect(c) {
    const cfg = readConfig(c);
    const pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // Smoke-test the connection so failures surface at connect-time.
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("SELECT 1");
    } catch (err) {
      await pool.end().catch(() => undefined);
      throw new BaklavaException(
        makeError({
          code: "E_SOURCE_CONNECTION_FAILED",
          what: `Could not connect to Postgres at ${cfg.host}:${cfg.port}/${cfg.database}.`,
          why: (err as Error).message,
          fix: "Check host/port/database, credentials, network, and SSL settings.",
          raw: { host: cfg.host, port: cfg.port, database: cfg.database },
        })
      );
    } finally {
      client?.release();
    }
    return { pool, schema: cfg.schema };
  },

  async health(handle) {
    const start = Date.now();
    try {
      const r = await handle.pool.query("SELECT 1 AS ok");
      const latencyMs = Date.now() - start;
      if (r.rows[0]?.ok === 1) return { ok: true, latencyMs };
      return { ok: false, latencyMs, message: "unexpected SELECT 1 result" };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: (err as Error).message,
      };
    }
  },

  async listTables(handle) {
    const tablesResult = await handle.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [handle.schema]
    );
    if (tablesResult.rows.length === 0) return [];

    // Single round-trip for all columns of all tables in this schema.
    const columnsResult = await handle.pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: "YES" | "NO";
      ordinal_position: number;
    }>(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [handle.schema]
    );

    const byTable = new Map<string, ColumnInfo[]>();
    for (const row of columnsResult.rows) {
      const cols = byTable.get(row.table_name) ?? [];
      cols.push({
        name: row.column_name,
        nativeType: row.udt_name || row.data_type,
        duckdbType: pgToDuckDb(row.data_type, row.udt_name),
        nullable: row.is_nullable === "YES",
      });
      byTable.set(row.table_name, cols);
    }

    return tablesResult.rows.map((t) => ({
      table: t.table_name,
      columns: byTable.get(t.table_name) ?? [],
    }));
  },

  async *fetchRows(handle, spec) {
    const limit = clampLimit(spec.limit);

    // Verify table + columns exist before pushing the query through.
    const meta = await handle.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2`,
      [handle.schema, spec.table]
    );
    if (meta.rows.length === 0) {
      throw new BaklavaException(
        makeError({
          code: "E_SOURCE_FETCH_FAILED",
          what: `Table "${spec.table}" does not exist in schema "${handle.schema}".`,
          why: "The plan referenced a table the source no longer has — possible schema drift.",
          fix: "Re-run schema discovery and retry the query.",
        })
      );
    }
    const declared = new Set(meta.rows.map((r) => r.column_name));
    const requested = spec.columns?.length ? spec.columns : [...declared];
    for (const col of requested) {
      if (!declared.has(col)) {
        throw new BaklavaException(
          makeError({
            code: "E_AI_PLAN_VALIDATION_FAILED",
            what: `Plan asks for column "${col}" on "${spec.table}" but it doesn't exist.`,
            why: "The AI may have hallucinated a column name; the plugin refuses to fetch it.",
            fix: "Re-sample the schema and let the AI try again.",
          })
        );
      }
    }

    const params: unknown[] = [];
    const paramIndex = { i: 1 };
    const whereSql = compileWhere(spec.where, declared, paramIndex, params);
    const colList = requested.map(quoteIdent).join(", ");
    const sql = `SELECT ${colList} FROM ${quoteIdent(handle.schema)}.${quoteIdent(spec.table)} ${
      whereSql ? `WHERE ${whereSql}` : ""
    } LIMIT ${limit}`;

    const result = await handle.pool.query({ text: sql, values: params });
    for (const row of result.rows) yield row as Record<string, unknown>;
  },

  async disconnect(handle) {
    await handle.pool.end();
  },
};
