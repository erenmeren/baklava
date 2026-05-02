import { Parser } from "node-sql-parser";
import { withDuck, allRows } from "../duck";
import { BaklavaException, makeError } from "../errors";

export interface DeclaredColumn {
  name: string;
  duckdbType: string;
}

export interface DeclaredSource {
  /** The bare table identifier the SQL must reference (e.g. "pg_users"). */
  table: string;
  /** Columns we will populate in DuckDB; SQL may not reference others. */
  columns: DeclaredColumn[];
}

export interface ValidatePlanInput {
  sql: string;
  sources: DeclaredSource[];
}

export interface ValidatePlanOk {
  ok: true;
}

export interface ValidatePlanFail {
  ok: false;
  reason: string;
  offendingToken?: string;
}

export type ValidationResult = ValidatePlanOk | ValidatePlanFail;

const FORBIDDEN_AST_TYPES = new Set([
  "insert",
  "update",
  "delete",
  "replace",
  "create",
  "drop",
  "alter",
  "truncate",
  "rename",
  "call",
  "use",
  "grant",
  "revoke",
  "set",
  "show",
  "lock",
  "unlock",
  "transaction",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "exec",
  "execute",
  "load",
  "install",
  "attach",
  "detach",
  "pragma",
  "copy",
  "export",
  "import",
]);

const ALLOWED_TOP_LEVEL = new Set(["select"]);

function fail(reason: string, offendingToken?: string): ValidatePlanFail {
  const result: ValidatePlanFail = { ok: false, reason };
  if (offendingToken !== undefined) result.offendingToken = offendingToken;
  return result;
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

interface AstWalkResult {
  ok: boolean;
  reason?: string;
  offending?: string;
}

/**
 * Walk the AST to confirm:
 *   - the root statement is SELECT (or a SELECT-shaped UNION/INTERSECT/EXCEPT)
 *   - no FROM entry is a function call (kills `read_json_auto`, `read_parquet`, etc.)
 *   - no nested statement is a forbidden type
 */
function walkAst(node: unknown): AstWalkResult {
  if (!node) return { ok: true };
  if (Array.isArray(node)) {
    for (const child of node) {
      const r = walkAst(child);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (typeof node !== "object") return { ok: true };

  const obj = node as Record<string, unknown>;
  const t = typeof obj.type === "string" ? (obj.type as string).toLowerCase() : null;

  if (t && FORBIDDEN_AST_TYPES.has(t)) {
    return { ok: false, reason: `forbidden statement type: ${t}`, offending: t };
  }

  // FROM-clause guard: every entry must be a plain table reference.
  // node-sql-parser uses `expr` for derived/function table sources.
  if ("from" in obj && Array.isArray(obj.from)) {
    for (const entry of obj.from as unknown[]) {
      if (!entry || typeof entry !== "object") continue;
      const fe = entry as Record<string, unknown>;
      if (fe.expr) {
        // A subquery-as-table is an object with type === 'select' — that's fine.
        // A function-as-table has expr.type === 'function' or similar.
        const expr = fe.expr as Record<string, unknown>;
        if (expr.type !== "select" && expr.ast?.constructor !== Object) {
          // Allow inner SELECTs (subqueries); reject everything else.
          if (expr.type !== "select") {
            return {
              ok: false,
              reason: "FROM clause contains a non-table reference (function or unknown expression)",
              offending: typeof expr.type === "string" ? (expr.type as string) : "unknown",
            };
          }
        }
      }
    }
  }

  // Block table-valued function calls anywhere in the AST.
  // node-sql-parser tags these as { type: 'function', name: '...' } inside FROM,
  // but they can also surface as expressions; we ban them to be safe.
  if (t === "function") {
    const name = typeof obj.name === "string" ? obj.name : "";
    const lower = name.toLowerCase();
    if (
      lower.startsWith("read_") ||
      lower === "attach" ||
      lower === "load" ||
      lower === "install" ||
      lower === "copy"
    ) {
      return {
        ok: false,
        reason: `forbidden function call: ${name}`,
        offending: name,
      };
    }
  }

  for (const key of Object.keys(obj)) {
    const r = walkAst(obj[key]);
    if (!r.ok) return r;
  }
  return { ok: true };
}

const parser = new Parser();

export async function validatePlan(input: ValidatePlanInput): Promise<ValidationResult> {
  const sql = input.sql.trim();
  if (!sql) return fail("SQL is empty");

  // Layer 1: parse with PG dialect.
  let astRoot: unknown;
  try {
    astRoot = parser.astify(sql, { database: "postgresql" });
  } catch (err) {
    return fail(`SQL did not parse: ${(err as Error).message}`);
  }
  if (astRoot === null) return fail("SQL parser returned a null AST");

  // node-sql-parser returns either a single AST or an array. Reject multi-statement.
  const statements = Array.isArray(astRoot) ? astRoot : [astRoot];
  if (statements.length === 0) return fail("SQL parser returned no statements");
  if (statements.length > 1) return fail("multi-statement SQL is not allowed");

  const root = statements[0] as { type?: string };
  const rootType = typeof root.type === "string" ? root.type.toLowerCase() : "";
  if (!ALLOWED_TOP_LEVEL.has(rootType)) {
    return fail(`top-level statement must be SELECT, got: ${rootType}`, rootType);
  }

  // Layer 2: walk the full AST to ban forbidden node types and FROM-function-tables.
  const walk = walkAst(astRoot);
  if (!walk.ok) {
    return fail(walk.reason ?? "AST contains a forbidden construct", walk.offending);
  }

  // Layer 3: bind the SQL against a fresh DuckDB instance with only the declared
  // tables present. Any reference to an undeclared table or column will fail EXPLAIN.
  try {
    await withDuck(async (db) => {
      for (const src of input.sources) {
        const cols = src.columns
          .map((c) => `${quoteIdent(c.name)} ${c.duckdbType}`)
          .join(", ");
        await runSql(db, `CREATE TABLE ${quoteIdent(src.table)} (${cols})`);
      }
      // EXPLAIN binds the query against the schema without executing it.
      await allRows(db, `EXPLAIN ${sql}`);
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return fail(`DuckDB rejected the query: ${msg}`);
  }

  return { ok: true };
}

function runSql(db: import("duckdb").Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Convert a validation failure into a BaklavaError. Use this at API boundaries
 * to surface a structured error to the UI.
 */
export function asBaklavaError(failure: ValidatePlanFail): ReturnType<typeof makeError> {
  return makeError({
    code: "E_AI_PLAN_VALIDATION_FAILED",
    what: "The AI's query plan was rejected by the safety validator.",
    why: failure.reason,
    fix: "baklava will auto-retry once with the failure reason. If that also fails, you can edit the SQL by hand or rephrase your question.",
    raw: failure.offendingToken
      ? { offendingToken: failure.offendingToken }
      : undefined,
  });
}

export function throwIfInvalid(result: ValidationResult): asserts result is ValidatePlanOk {
  if (!result.ok) {
    throw new BaklavaException(asBaklavaError(result));
  }
}
