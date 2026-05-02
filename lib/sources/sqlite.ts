import Database from "better-sqlite3";
import { BaklavaException, makeError } from "../errors";
import {
  type ColumnInfo,
  type ConnectionConfig,
  type FilterClause,
  type Plugin,
  type SchemaInfo,
  clampLimit,
} from "./types";

interface SqliteConfig {
  path: string;
  readonly?: boolean;
}

export type SqliteHandle = Database.Database;

function readConfig(c: ConnectionConfig): SqliteConfig {
  const path = (c.config as { path?: unknown }).path;
  if (typeof path !== "string" || path.length === 0) {
    throw new BaklavaException(
      makeError({
        code: "E_CONNECTION_NOT_FOUND",
        what: `SQLite connection "${c.name}" is missing a "path" field.`,
        why: "The SQLite plugin needs a filesystem path (or ':memory:').",
        fix: 'Add "path": "/absolute/path/to/db.sqlite" to the connection config.',
      })
    );
  }
  const readonly = (c.config as { readonly?: unknown }).readonly === true;
  return { path, readonly };
}

/**
 * Map SQLite's loose declared types to a DuckDB type for federation.
 * SQLite uses type affinity, so we lean on the declared text rather than the runtime value.
 */
function sqliteToDuckDb(declared: string): string {
  const t = declared.toUpperCase();
  if (t.includes("INT")) return "BIGINT"; // SQLite INTEGER is 64-bit
  if (t.includes("CHAR") || t.includes("TEXT") || t.includes("CLOB")) return "VARCHAR";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "DOUBLE";
  if (t.includes("BLOB") || t.length === 0) return "BLOB";
  if (t.includes("NUMERIC") || t.includes("DECIMAL")) return "DECIMAL(38,10)";
  if (t.includes("BOOL")) return "BOOLEAN";
  if (t.includes("DATE") || t.includes("TIME")) return "TIMESTAMP";
  return "VARCHAR";
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function compileWhere(
  clause: FilterClause | undefined,
  allowedColumns: Set<string>
): { sql: string; params: unknown[] } {
  if (!clause) return { sql: "", params: [] };
  const params: unknown[] = [];
  const sql = compileClause(clause, allowedColumns, params);
  return { sql: sql ? `WHERE ${sql}` : "", params };
}

function compileClause(
  clause: FilterClause,
  allowedColumns: Set<string>,
  params: unknown[]
): string {
  if (clause.op === "and" || clause.op === "or") {
    const compiled = clause.clauses
      .map((c) => compileClause(c, allowedColumns, params))
      .filter((s) => s.length > 0);
    if (compiled.length === 0) return "";
    return `(${compiled.join(` ${clause.op.toUpperCase()} `)})`;
  }
  // Leaf clauses all share { column, value(s) } — assert + narrow.
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
  switch (leaf.op) {
    case "eq":
      if (leaf.value === null) return `${col} IS NULL`;
      params.push(leaf.value);
      return `${col} = ?`;
    case "neq":
      if (leaf.value === null) return `${col} IS NOT NULL`;
      params.push(leaf.value);
      return `${col} != ?`;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const opMap = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
      params.push(leaf.value);
      return `${col} ${opMap[leaf.op]} ?`;
    }
    case "in":
    case "nin": {
      if (leaf.values.length === 0) {
        // Empty IN list is always-false; empty NIN is always-true.
        return leaf.op === "in" ? "1=0" : "1=1";
      }
      const placeholders = leaf.values.map(() => "?").join(",");
      for (const v of leaf.values) params.push(v);
      return `${col} ${leaf.op === "in" ? "IN" : "NOT IN"} (${placeholders})`;
    }
  }
}

export const sqlitePlugin: Plugin<SqliteHandle> = {
  name: "sqlite",

  validateConfig(c) {
    readConfig(c);
  },

  async connect(c) {
    const cfg = readConfig(c);
    try {
      return new Database(cfg.path, { readonly: cfg.readonly ?? false });
    } catch (err) {
      throw new BaklavaException(
        makeError({
          code: "E_SOURCE_CONNECTION_FAILED",
          what: `Could not open SQLite database at ${cfg.path}.`,
          why: `${(err as Error).message}`,
          fix: "Check the path exists and is readable, or change the path in your connection config.",
          raw: { path: cfg.path },
        })
      );
    }
  },

  async health(handle) {
    const start = Date.now();
    try {
      const r = handle.prepare("SELECT 1 AS ok").get() as { ok?: number };
      const latencyMs = Date.now() - start;
      if (r?.ok === 1) return { ok: true, latencyMs };
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
    const tables = handle
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as { name: string }[];

    const out: SchemaInfo[] = [];
    for (const { name } of tables) {
      const rows = handle.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as {
        name: string;
        type: string;
        notnull: number;
      }[];
      const columns: ColumnInfo[] = rows.map((r) => ({
        name: r.name,
        nativeType: r.type || "TEXT",
        duckdbType: sqliteToDuckDb(r.type || "TEXT"),
        nullable: r.notnull === 0,
      }));
      out.push({ table: name, columns });
    }
    return out;
  },

  async *fetchRows(handle, spec) {
    const limit = clampLimit(spec.limit);
    const tables = handle
      .prepare(`PRAGMA table_info(${quoteIdent(spec.table)})`)
      .all() as { name: string }[];
    if (tables.length === 0) {
      throw new BaklavaException(
        makeError({
          code: "E_SOURCE_FETCH_FAILED",
          what: `Table "${spec.table}" does not exist in this SQLite database.`,
          why: "The plan referenced a table the source no longer has — possible schema drift since the last sample.",
          fix: "Re-run schema discovery (the connection's Test Connection button) and retry the query.",
        })
      );
    }
    const declaredCols = new Set(tables.map((t) => t.name));
    const requested = spec.columns?.length ? spec.columns : [...declaredCols];
    for (const col of requested) {
      if (!declaredCols.has(col)) {
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
    const colList = requested.map(quoteIdent).join(", ");
    const where = compileWhere(spec.where, declaredCols);
    const sql = `SELECT ${colList} FROM ${quoteIdent(spec.table)} ${where.sql} LIMIT ${limit}`;

    let stmt;
    try {
      stmt = handle.prepare(sql);
    } catch (err) {
      throw new BaklavaException(
        makeError({
          code: "E_SOURCE_FETCH_FAILED",
          what: `SQLite rejected the fetch query for "${spec.table}".`,
          why: (err as Error).message,
          fix: "Check the column names and filter shape; this usually means a schema mismatch.",
          raw: { sql },
        })
      );
    }
    for (const row of stmt.iterate(...where.params) as IterableIterator<
      Record<string, unknown>
    >) {
      yield row;
    }
  },

  async disconnect(handle) {
    handle.close();
  },
};
