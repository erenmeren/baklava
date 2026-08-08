/**
 * SQL Server driver — query editor (GO-aware batch execution), read-only
 * query helper (AI tools path), and estimated execution plan.
 */
import type { SqlServerConfig } from "../types";
import { withPool } from "./internal";
import { SQLSERVER_DB_NAME_RE, requireNoStatementTerminator, splitGoBatches } from "./sql";

// ─── Query editor: GO-aware batch execution ─────────────────────────────

export interface SqlServerResultSet {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

export interface SqlServerBatchResult {
  /** The batch text that produced this result (trimmed). */
  sql: string;
  /** One entry per recordset the batch returned (a proc can emit several). */
  resultSets: SqlServerResultSet[];
  /** rowsAffected per statement in the batch. */
  rowsAffected: number[];
  /** SET STATISTICS IO/TIME + PRINT output emitted while running. */
  messages: string[];
  durationMs: number;
  error?: string;
}

export interface SqlServerMultiResult {
  batches: SqlServerBatchResult[];
  totalDurationMs: number;
}

const MAX_RESULT_ROWS = 1000;

/**
 * Run a T-SQL script as a sequence of GO-delimited batches and return one
 * result per batch. Errors are captured per-batch (execution continues).
 * Optionally prepends SET STATISTICS IO/TIME so the messages stream carries
 * the logical-reads / elapsed numbers developers compare rewrites with.
 */
export async function runSqlServerScript(
  config: SqlServerConfig,
  database: string | undefined,
  script: string,
  opts: { statistics?: boolean } = {},
): Promise<SqlServerMultiResult> {
  const db = database && SQLSERVER_DB_NAME_RE.test(database) ? database : undefined;
  return withPool(
    config,
    async (pool) => {
      const overall = Date.now();
      const batches = splitGoBatches(script);
      const out: SqlServerBatchResult[] = [];
      for (const batch of batches) {
        for (let rep = 0; rep < batch.count; rep++) {
          const start = Date.now();
          const messages: string[] = [];
          const req = pool.request();
          // Stream rows as they arrive and cancel the moment a result set
          // exceeds the cap, instead of buffering the whole recordset and
          // slicing afterwards. The old approach pulled every matching row over
          // the wire first, so `SELECT *` over a large table hit the request
          // timeout long before the 1000-row slice ever applied.
          req.stream = true;
          req.on("info", (info) => {
            if (info?.message) messages.push(info.message);
          });
          type Acc = {
            fields: string[];
            rows: unknown[][];
            received: number;
            truncated: boolean;
          };
          const accs: Acc[] = [];
          const rowsAffected: number[] = [];
          let current: Acc | null = null;
          let canceled = false;
          let streamError: Error | null = null;
          req.on("recordset", (columns) => {
            current = {
              fields: Object.keys(columns),
              rows: [],
              received: 0,
              truncated: false,
            };
            accs.push(current);
          });
          req.on("row", (row) => {
            if (!current) return;
            current.received += 1;
            if (current.rows.length < MAX_RESULT_ROWS) {
              current.rows.push(current.fields.map((f) => row[f] ?? null));
            } else {
              current.truncated = true;
              if (!canceled) {
                canceled = true;
                req.cancel(); // stop the firehose — the promise still resolves
              }
            }
          });
          req.on("rowsaffected", (count) => {
            rowsAffected.push(count);
          });
          req.on("error", (err) => {
            // Our own cancel() surfaces as ECANCEL — an intentional truncation,
            // not a failure. Any other error is the batch failing for real.
            if (err?.code === "ECANCEL") return;
            if (!streamError) streamError = err;
          });
          const text = opts.statistics
            ? `SET STATISTICS IO ON; SET STATISTICS TIME ON;\n${batch.sql}`
            : batch.sql;
          try {
            // In stream mode the promise resolves on `done` even when the batch
            // errored (the error arrives via the 'error' event), so re-throw it.
            await req.batch(text);
            if (streamError) throw streamError;
            const resultSets: SqlServerResultSet[] = accs.map((a) => ({
              fields: a.fields,
              rows: a.rows,
              // When truncated the true total is unknown (we cancelled early),
              // so report the rows actually returned and let `truncated` carry
              // the "more exist" signal.
              rowCount: a.truncated ? a.rows.length : a.received,
              truncated: a.truncated,
            }));
            out.push({
              sql: batch.sql,
              resultSets,
              rowsAffected,
              messages,
              durationMs: Date.now() - start,
            });
          } catch (err) {
            out.push({
              sql: batch.sql,
              resultSets: [],
              rowsAffected: [],
              messages,
              durationMs: Date.now() - start,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      return { batches: out, totalDurationMs: Date.now() - overall };
    },
    { database: db, requestTimeoutMs: 60_000 },
  );
}

// ─── Read-only query helper (AI tools path) ─────────────────────────────

export interface ReadOnlyResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
}

// Defense-in-depth denylist for the read-only AI query path. The rollback wrap
// below is the real backstop; this just rejects obvious writes early. `_` is a
// word char so this won't trip on column names like `update_time`.
const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|drop|create|alter|truncate|exec|execute|grant|revoke|into|sp_|xp_)\b/i;

/**
 * Run a single read-only statement. SQL Server has no READ ONLY transaction, so
 * we (1) block ';' (single statement), (2) reject write keywords, and (3) wrap in
 * BEGIN TRAN … ROLLBACK so anything that slips past still never persists.
 */
export async function runReadOnlyQuery(
  config: SqlServerConfig,
  database: string,
  sql: string,
  maxRows = 1000,
): Promise<ReadOnlyResult> {
  const single = requireNoStatementTerminator(sql.trim().replace(/;+\s*$/g, ""), "Query");
  const m = single.match(WRITE_KEYWORDS);
  if (m) {
    throw new Error(`Read-only query rejected: contains a write keyword ("${m[0]}").`);
  }
  return withPool(
    config,
    async (pool) => {
      const res = await pool.request().batch(`BEGIN TRAN;\n${single};\nROLLBACK;`);
      const rs = (res.recordset ?? []) as unknown as Array<Record<string, unknown>> & {
        columns?: Record<string, unknown>;
      };
      const fields = rs.columns ? Object.keys(rs.columns) : rs[0] ? Object.keys(rs[0]) : [];
      const capped = rs.slice(0, maxRows);
      return {
        fields,
        rows: capped.map((row) => fields.map((f) => row[f] ?? null)),
        rowCount: capped.length,
      };
    },
    { database },
  );
}

// ─── Estimated execution plan ────────────────────────────────────────────

export interface PlanNode {
  physicalOp: string;
  logicalOp: string;
  /** Estimated cumulative subtree cost. */
  subtreeCost: number;
  estimateRows: number;
  /** Object touched (table/index), best-effort. */
  object: string | null;
  /** Percentage of total plan cost this node alone contributes. */
  costPct: number;
  children: PlanNode[];
}

export interface MissingIndex {
  impact: number;
  statement: string;
  createStatement: string;
}

export interface SqlServerPlan {
  root: PlanNode | null;
  totalCost: number;
  missingIndexes: MissingIndex[];
  rawXml: string;
}

interface RawRelOp {
  PhysicalOp?: string;
  LogicalOp?: string;
  EstimatedTotalSubtreeCost?: string | number;
  EstimateRows?: string | number;
  RelOp?: RawRelOp | RawRelOp[];
  [k: string]: unknown;
}

/** Get the estimated query plan via SHOWPLAN_XML (no execution) and parse it. */
export async function getSqlServerEstimatedPlan(
  config: SqlServerConfig,
  database: string | undefined,
  query: string,
): Promise<SqlServerPlan> {
  const { XMLParser } = await import("fast-xml-parser");
  const db = database && SQLSERVER_DB_NAME_RE.test(database) ? database : undefined;
  return withPool(
    config,
    async (pool) => {
      // SHOWPLAN_XML must be its own batch; the plan comes back as a single
      // XML column from the *next* batch.
      await pool.request().batch("SET SHOWPLAN_XML ON");
      const res = await pool.request().batch(query);
      await pool.request().batch("SET SHOWPLAN_XML OFF").catch(() => undefined);
      const row = (res.recordset?.[0] ?? {}) as Record<string, unknown>;
      const xml = String(Object.values(row)[0] ?? "");
      if (!xml) {
        return { root: null, totalCost: 0, missingIndexes: [], rawXml: "" };
      }

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        isArray: (name) => name === "RelOp" || name === "MissingIndexGroup" || name === "MissingIndex" || name === "Column",
      });
      const parsed = parser.parse(xml) as Record<string, unknown>;

      // Drill to the first statement's QueryPlan.RelOp.
      const findFirst = (obj: unknown, key: string): unknown => {
        if (!obj || typeof obj !== "object") return undefined;
        const rec = obj as Record<string, unknown>;
        if (key in rec) return rec[key];
        for (const v of Object.values(rec)) {
          const found = findFirst(v, key);
          if (found !== undefined) return found;
        }
        return undefined;
      };

      const queryPlan = findFirst(parsed, "QueryPlan") as Record<string, unknown> | undefined;
      const rootRaw = queryPlan
        ? ((Array.isArray(queryPlan.RelOp) ? queryPlan.RelOp[0] : queryPlan.RelOp) as RawRelOp | undefined)
        : undefined;

      const totalCost = rootRaw ? Number(rootRaw.EstimatedTotalSubtreeCost ?? 0) : 0;

      const convert = (raw: RawRelOp): PlanNode => {
        const children = raw.RelOp
          ? (Array.isArray(raw.RelOp) ? raw.RelOp : [raw.RelOp]).map(convert)
          : [];
        const subtreeCost = Number(raw.EstimatedTotalSubtreeCost ?? 0);
        const childCost = children.reduce((s, c) => s + c.subtreeCost, 0);
        const ownCost = Math.max(0, subtreeCost - childCost);
        // best-effort object name from any nested Object node
        const objNode = findFirst(raw, "Object") as Record<string, unknown> | Record<string, unknown>[] | undefined;
        const first = Array.isArray(objNode) ? objNode[0] : objNode;
        const object = first
          ? [first.Schema, first.Table, first.Index].filter(Boolean).map(String).join(".") || null
          : null;
        return {
          physicalOp: String(raw.PhysicalOp ?? "?"),
          logicalOp: String(raw.LogicalOp ?? ""),
          subtreeCost,
          estimateRows: Number(raw.EstimateRows ?? 0),
          object,
          costPct: totalCost > 0 ? (ownCost / totalCost) * 100 : 0,
          children,
        };
      };

      const root = rootRaw ? convert(rootRaw) : null;

      // Missing indexes.
      const missingIndexes: MissingIndex[] = [];
      const miGroup = findFirst(parsed, "MissingIndexes") as Record<string, unknown> | undefined;
      if (miGroup) {
        const groups = miGroup.MissingIndexGroup;
        const arr = Array.isArray(groups) ? groups : groups ? [groups] : [];
        for (const g of arr as Record<string, unknown>[]) {
          const impact = Number(g.Impact ?? 0);
          const mi = Array.isArray(g.MissingIndex) ? g.MissingIndex[0] : g.MissingIndex;
          if (!mi) continue;
          const m = mi as Record<string, unknown>;
          const schema = String(m.Schema ?? "").replace(/[[\]]/g, "");
          const table = String(m.Table ?? "").replace(/[[\]]/g, "");
          // Build a CREATE INDEX from the ColumnGroups (Usage EQUALITY/INEQUALITY/INCLUDE).
          const cgs = Array.isArray(m.ColumnGroup) ? m.ColumnGroup : m.ColumnGroup ? [m.ColumnGroup] : [];
          const key: string[] = [];
          const include: string[] = [];
          for (const cg of cgs as Record<string, unknown>[]) {
            const usage = String(cg.Usage ?? "");
            const cols = Array.isArray(cg.Column) ? cg.Column : cg.Column ? [cg.Column] : [];
            for (const c of cols as Record<string, unknown>[]) {
              const name = String(c.Name ?? "").replace(/[[\]]/g, "");
              if (usage === "INCLUDE") include.push(name);
              else key.push(name);
            }
          }
          const createStatement = `CREATE NONCLUSTERED INDEX [IX_${table}_missing] ON [${schema}].[${table}] (${key
            .map((c) => `[${c}]`)
            .join(", ")})${include.length ? ` INCLUDE (${include.map((c) => `[${c}]`).join(", ")})` : ""};`;
          missingIndexes.push({
            impact,
            statement: `${schema}.${table}`,
            createStatement,
          });
        }
      }

      return { root, totalCost, missingIndexes, rawXml: xml };
    },
    { database: db, requestTimeoutMs: 30_000 },
  );
}
