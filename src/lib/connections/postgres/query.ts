/**
 * Postgres driver — the SQL editor's query surface: EXPLAIN, single-
 * statement run, read-only run, and multi-statement run.
 */
import type { Client as PgClient } from "pg"; // type-only — erased at build, safe when pg absent
import type { PostgresConfig } from "../types";
import { withClient } from "./client";
import { quoteIdent, validateIdentifier, requireNoStatementTerminator, splitSqlStatements } from "./sql";
import { getPgCursor } from "./internal";

export interface QueryResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  /** True when the rowset was capped (more rows exist than were returned). */
  truncated?: boolean;
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

/** Editor row cap — matches the SQL Server editor so all SQL workspaces agree. */
const EDITOR_ROW_CAP = 1000;

/**
 * True when a statement produces a rowset that could be huge. Only these run
 * through a server-side cursor (we fetch `cap + 1` rows then close the portal,
 * so the rest is never executed/transferred). Utility / DDL / DML statements
 * (VACUUM, CREATE, INSERT, …) are NOT cursor-safe — the cursor's extended-
 * protocol implicit transaction rejects some of them (e.g. "VACUUM cannot run
 * inside a transaction block") — so they keep the plain buffered path.
 */
function isRowReturning(stmt: string): boolean {
  const s = stmt
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " ") // line comments
    .trimStart();
  return /^\(*\s*(?:with|select|table|values|show|explain)\b/i.test(s);
}

/**
 * Run one row-returning statement through a cursor, fetching at most
 * `maxRows + 1` rows (the extra row tells us whether more exist), then closing
 * the portal so Postgres stops executing. Never buffers the full result.
 */
async function readBounded(
  client: PgClient,
  text: string,
  maxRows: number,
): Promise<{
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  command: string | null;
}> {
  const Cursor = await getPgCursor();
  const cursor = new Cursor<unknown[]>(text, undefined, { rowMode: "array" });
  // pg's Client.query() recognises a Submittable and drives the cursor.
  (client as unknown as { query: (c: unknown) => unknown }).query(cursor);
  try {
    const { rows, result } = await new Promise<{
      rows: unknown[][];
      result: { fields: { name: string }[]; rowCount: number | null; command: string };
    }>((resolve, reject) => {
      cursor.read(maxRows + 1, (err, r, res) =>
        err ? reject(err) : resolve({ rows: r as unknown[][], result: res }),
      );
    });
    const truncated = rows.length > maxRows;
    const capped = truncated ? rows.slice(0, maxRows) : rows;
    return {
      fields: (result.fields ?? []).map((f) => f.name),
      rows: capped,
      // When truncated we cancelled before CommandComplete, so the true total
      // is unknown — report what we returned and let `truncated` signal more.
      rowCount: truncated ? capped.length : result.rowCount ?? capped.length,
      truncated,
      command: result.command ?? null,
    };
  } finally {
    await cursor.close().catch(() => undefined);
  }
}

export async function runQuery(
  config: PostgresConfig,
  database: string,
  sql: string
): Promise<QueryResult> {
  return withClient(config, database, async (client) => {
    const start = Date.now();
    if (isRowReturning(sql)) {
      const r = await readBounded(client, sql, EDITOR_ROW_CAP);
      return {
        fields: r.fields,
        rows: r.rows,
        rowCount: r.rowCount,
        truncated: r.truncated,
        durationMs: Date.now() - start,
      };
    }
    const res = await client.query({ text: sql, rowMode: "array" });
    return {
      fields: res.fields.map((f) => f.name),
      rows: res.rows as unknown[][],
      rowCount: res.rowCount ?? res.rows.length,
      durationMs: Date.now() - start,
    };
  });
}

/**
 * Run a SELECT/analytics statement enforced READ-ONLY at the database level.
 * Wraps the user's SQL in `BEGIN TRANSACTION READ ONLY … ROLLBACK`, so Postgres
 * itself rejects any write (INSERT/UPDATE/DELETE/DDL) with
 * "cannot execute … in a read-only transaction" — even if the model is tricked
 * into emitting one. Used by the AI `pg_run_sql` tool. Row output is capped.
 */
export async function runReadOnlyQuery(
  config: PostgresConfig,
  database: string,
  sql: string,
  maxRows = 1000,
): Promise<QueryResult> {
  // Defense-in-depth: the read-only transaction wrapper alone is bypassable via
  // multi-statement injection ("COMMIT; INSERT …" ends the read-only txn, then
  // the rest runs read-write). Reject any statement terminator so only a single
  // read statement can run. This is the reliable guard; the txn is a backstop.
  const single = requireNoStatementTerminator(sql.trim().replace(/;+\s*$/g, ""), "Query");
  return withClient(config, database, async (client) => {
    const start = Date.now();
    await client.query("BEGIN TRANSACTION READ ONLY");
    try {
      const res = await client.query({ text: single, rowMode: "array" });
      const rows = (res.rows as unknown[][]).slice(0, maxRows);
      return {
        fields: res.fields.map((f) => f.name),
        rows,
        rowCount: res.rowCount ?? rows.length,
        durationMs: Date.now() - start,
      };
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
    }
  });
}

export interface QueryStatementResult extends QueryResult {
  /** The statement text that produced this result (trimmed). */
  sql: string;
  /** True when the statement returned no rowset (e.g. INSERT, DDL). */
  isCommand: boolean;
  /** "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", … as reported by pg. */
  command: string | null;
}

export interface QueryStatementError {
  sql: string;
  error: string;
  durationMs: number;
}

export interface MultiQueryResult {
  results: Array<QueryStatementResult | QueryStatementError>;
  totalDurationMs: number;
}

/**
 * Run a sequence of statements and return a result per statement so the
 * editor can present them in separate result tabs. Statements run on a
 * single connection so transaction state is preserved between them; errors
 * are recorded inline and execution continues with the next statement.
 */
export async function runQueryMulti(
  config: PostgresConfig,
  database: string,
  sql: string,
  opts?: { searchPath?: string },
): Promise<MultiQueryResult> {
  return withClient(config, database, async (client) => {
    // Apply per-call search_path for this run. The connection is pooled, but
    // withClient runs DISCARD ALL before returning it to the pool, so this SET
    // does not leak into the next borrow. Whitelisted + quoted, then runs
    // silently — not reported in `out` so the user's multi-result panel only
    // shows their own statements.
    if (opts?.searchPath && opts.searchPath.trim()) {
      const sp = validateIdentifier(opts.searchPath.trim(), "Schema");
      await client.query(`SET search_path TO ${quoteIdent(sp)}, public`);
    }
    const stmts = splitSqlStatements(sql);
    const overall = Date.now();
    const out: MultiQueryResult["results"] = [];
    for (const stmt of stmts) {
      const start = Date.now();
      try {
        if (isRowReturning(stmt)) {
          // Cursor path: fetch only what we display, never buffer millions.
          const r = await readBounded(client, stmt, EDITOR_ROW_CAP);
          out.push({
            sql: stmt,
            fields: r.fields,
            rows: r.rows,
            rowCount: r.rowCount,
            truncated: r.truncated,
            durationMs: Date.now() - start,
            isCommand: r.fields.length === 0,
            command: r.command,
          });
          continue;
        }
        const res = await client.query({ text: stmt, rowMode: "array" });
        const fields = res.fields.map((f) => f.name);
        out.push({
          sql: stmt,
          fields,
          rows: res.rows as unknown[][],
          rowCount: res.rowCount ?? (res.rows as unknown[]).length,
          durationMs: Date.now() - start,
          isCommand: fields.length === 0,
          command:
            (res as unknown as { command?: string }).command ?? null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.push({
          sql: stmt,
          error: msg,
          durationMs: Date.now() - start,
        });
      }
    }
    return { results: out, totalDurationMs: Date.now() - overall };
  });
}

