import { BaklavaException, makeError } from "./errors.js";
import { allRows, withDuck } from "./duck.js";
import {
  validatePlan,
  type DeclaredColumn,
  type DeclaredSource,
} from "./ai/validate.js";
import { generatePlanWithRetry } from "./ai/retry.js";
import type { PlanGenerator, RawPlan } from "./ai/plan.js";
import {
  tableAliasFor,
  type ConnectionSchema,
  type ConnectionTableSchema,
} from "./ai/prompt.js";
import {
  clampLimit,
  type Plugin,
  type SchemaInfo,
} from "./sources/types.js";

const RESPONSE_PAGE_SIZE = 1000;

/** A connection that's already been connected and had its schemas listed. */
export interface RegisteredSource {
  connectionName: string;
  pluginName: string;
  plugin: Plugin<unknown>;
  handle: unknown;
  schemas: SchemaInfo[];
}

export interface RunQueryInput {
  nl: string;
  sources: RegisteredSource[];
  /** Per-source row ceiling; default 1000, max 100000. */
  perSourceLimit?: number;
  /** Override the AI generator for tests. */
  generator?: PlanGenerator;
}

export interface RunQueryResult {
  plan: { english: string; sql: string };
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncations: { connection: string; table: string; appliedLimit: number }[];
  attempts: 1 | 2;
  timingMs: {
    plan: number;
    fetch: number;
    execute: number;
    total: number;
  };
  page: { size: number; cursor: null; hasMore: boolean };
}

interface AliasIndex {
  /** alias → (registered source + the schema info for that table). */
  bySchemaAlias: Map<string, { source: RegisteredSource; table: SchemaInfo }>;
  /** "connection|table" → alias. */
  byConnTable: Map<string, string>;
}

function buildAliasIndex(sources: RegisteredSource[]): AliasIndex {
  const bySchemaAlias = new Map<string, { source: RegisteredSource; table: SchemaInfo }>();
  const byConnTable = new Map<string, string>();
  for (const src of sources) {
    for (const t of src.schemas) {
      const alias = tableAliasFor(src.connectionName, t.table);
      if (bySchemaAlias.has(alias)) {
        throw new BaklavaException(
          makeError({
            code: "E_INTERNAL",
            what: `Two tables collapsed to the same DuckDB alias "${alias}".`,
            why: "Connection or table names differ only by characters the alias-sanitizer strips.",
            fix: "Rename one of the connections to disambiguate.",
            raw: { alias },
          })
        );
      }
      bySchemaAlias.set(alias, { source: src, table: t });
      byConnTable.set(`${src.connectionName}|${t.table}`, alias);
    }
  }
  return { bySchemaAlias, byConnTable };
}

function buildConnectionSchemas(sources: RegisteredSource[]): ConnectionSchema[] {
  return sources.map((src) => ({
    connection: src.connectionName,
    plugin: src.pluginName,
    tables: src.schemas.map<ConnectionTableSchema>((t) => ({
      table: t.table,
      tableAlias: tableAliasFor(src.connectionName, t.table),
      ...(t.approximate !== undefined ? { approximate: t.approximate } : {}),
      ...(t.approximateNote !== undefined ? { approximateNote: t.approximateNote } : {}),
      columns: t.columns.map((c) => ({
        name: c.name,
        duckdbType: c.duckdbType,
        nullable: c.nullable,
      })),
    })),
  }));
}

function declaredSourcesFromPlan(
  plan: RawPlan,
  aliases: AliasIndex
): DeclaredSource[] {
  const out: DeclaredSource[] = [];
  for (const s of plan.sources) {
    const alias = aliases.byConnTable.get(`${s.connection}|${s.table}`);
    if (!alias) {
      throw new BaklavaException(
        makeError({
          code: "E_AI_PLAN_VALIDATION_FAILED",
          what: `Plan declares a source "${s.connection}.${s.table}" that isn't connected.`,
          why: "The AI hallucinated a connection or table that doesn't exist in this session.",
          fix: "Retry the query; the auto-retry feeds the failure back to the model.",
          raw: { plan: plan.sources },
        })
      );
    }
    const meta = aliases.bySchemaAlias.get(alias)!;
    const columns: DeclaredColumn[] = meta.table.columns.map((c) => ({
      name: c.name,
      duckdbType: c.duckdbType,
    }));
    out.push({ table: alias, columns });
  }
  return out;
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function runSql(db: import("duckdb").Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function runWithParams(
  db: import("duckdb").Database,
  sql: string,
  values: unknown[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, ...values, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

interface FetchedSource {
  alias: string;
  schema: SchemaInfo;
  rows: Record<string, unknown>[];
  truncated: boolean;
  connectionName: string;
}

async function fetchSources(
  plan: RawPlan,
  aliases: AliasIndex,
  perSourceLimit: number
): Promise<FetchedSource[]> {
  const out: FetchedSource[] = [];
  for (const s of plan.sources) {
    const alias = aliases.byConnTable.get(`${s.connection}|${s.table}`)!;
    const meta = aliases.bySchemaAlias.get(alias)!;
    const rows: Record<string, unknown>[] = [];
    let truncated = false;
    try {
      for await (const row of meta.source.plugin.fetchRows(meta.source.handle, {
        table: meta.table.table,
        columns: meta.table.columns.map((c) => c.name),
        limit: perSourceLimit,
      })) {
        rows.push(row);
        if (rows.length >= perSourceLimit) {
          truncated = true;
          break;
        }
      }
    } catch (err) {
      if (err instanceof BaklavaException) throw err;
      throw new BaklavaException(
        makeError({
          code: "E_SOURCE_FETCH_FAILED",
          what: `Fetching from "${s.connection}.${s.table}" failed.`,
          why: (err as Error).message,
          fix: "Re-run schema discovery and retry. If the source is unreachable, fix the connection.",
          raw: { connection: s.connection, table: s.table },
        })
      );
    }
    out.push({
      alias,
      schema: meta.table,
      rows,
      truncated,
      connectionName: s.connection,
    });
  }
  return out;
}

function coerceFromDuckDb(value: unknown): unknown {
  if (typeof value === "bigint") {
    // BigInts can't be JSON-serialized. Downcast if safe; otherwise stringify
    // to preserve precision. Most v0.1 federated joins are well under 2^53.
    if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(value);
    }
    return value.toString();
  }
  return value;
}

function coerceForDuckDb(value: unknown, duckdbType: string): unknown {
  if (value === null || value === undefined) return null;
  // DuckDB can take Date/number/string/boolean/Buffer directly.
  // For JSON-shaped types we stored as VARCHAR, ensure stringification.
  const upper = duckdbType.toUpperCase();
  if (
    upper === "VARCHAR" &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !(value instanceof Buffer)
  ) {
    return JSON.stringify(value);
  }
  return value as unknown;
}

export async function runQuery(input: RunQueryInput): Promise<RunQueryResult> {
  const totalStart = Date.now();
  const aliases = buildAliasIndex(input.sources);
  const connectionSchemas = buildConnectionSchemas(input.sources);

  if (connectionSchemas.length === 0) {
    throw new BaklavaException(
      makeError({
        code: "E_CONNECTION_NOT_FOUND",
        what: "No connections are configured.",
        why: "The pipeline can't plan a query when there are no sources.",
        fix: "Add a connection in Settings, then try again.",
      })
    );
  }

  // 1. Plan + validate (with one retry on failure).
  const planStart = Date.now();
  const { plan, attempts } = await generatePlanWithRetry({
    nl: input.nl,
    connections: connectionSchemas,
    ...(input.generator ? { generator: input.generator } : {}),
    validate: async (candidate) => {
      try {
        const declared = declaredSourcesFromPlan(candidate, aliases);
        return await validatePlan({ sql: candidate.sql, sources: declared });
      } catch (err) {
        if (err instanceof BaklavaException) {
          return { ok: false, reason: err.error.what };
        }
        return { ok: false, reason: (err as Error).message };
      }
    },
  });
  const planMs = Date.now() - planStart;

  // 2. Fetch declared sources up to the per-source limit.
  const fetchStart = Date.now();
  const perSourceLimit = clampLimit(input.perSourceLimit);
  const fetched = await fetchSources(plan, aliases, perSourceLimit);
  const fetchMs = Date.now() - fetchStart;

  // 3. Register tables in a fresh DuckDB instance and execute the SQL.
  const executeStart = Date.now();
  const result = await withDuck<{ columns: string[]; rows: unknown[][] }>(
    async (db) => {
      for (const f of fetched) {
        const colDefs = f.schema.columns
          .map((c) => `${quoteIdent(c.name)} ${c.duckdbType}`)
          .join(", ");
        await runSql(db, `CREATE TABLE ${quoteIdent(f.alias)} (${colDefs})`);
        if (f.rows.length === 0) continue;

        const colNames = f.schema.columns.map((c) => quoteIdent(c.name)).join(", ");
        const placeholders = f.schema.columns.map(() => "?").join(", ");
        const insertSql = `INSERT INTO ${quoteIdent(f.alias)} (${colNames}) VALUES (${placeholders})`;

        for (const row of f.rows) {
          const values = f.schema.columns.map((c) =>
            coerceForDuckDb(row[c.name], c.duckdbType)
          );
          await runWithParams(db, insertSql, values);
        }
      }
      const rows = await allRows<Record<string, unknown>>(db, plan.sql);
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
      const rowMatrix = rows
        .slice(0, RESPONSE_PAGE_SIZE)
        .map((r) => columns.map((c) => coerceFromDuckDb(r[c])));
      return { columns, rows: rowMatrix };
    }
  );
  const executeMs = Date.now() - executeStart;

  return {
    plan: { english: plan.plan_english, sql: plan.sql },
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rows.length,
    truncations: fetched
      .filter((f) => f.truncated)
      .map((f) => ({
        connection: f.connectionName,
        table: f.schema.table,
        appliedLimit: perSourceLimit,
      })),
    attempts,
    timingMs: {
      plan: planMs,
      fetch: fetchMs,
      execute: executeMs,
      total: Date.now() - totalStart,
    },
    page: { size: result.rows.length, cursor: null, hasMore: false },
  };
}
