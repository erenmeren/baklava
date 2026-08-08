/**
 * Postgres driver — dump / restore. Connects with a dedicated (unpooled)
 * Client so the statement timeout can be disabled for long-running jobs.
 */
import type { Client as PgClient } from "pg"; // type-only — erased at build, safe when pg absent
import type { PostgresConfig } from "../types";
import { quoteIdent } from "./sql";
import { listColumns, listConstraints, listIndexes } from "./catalog";
import { getPg, buildClientConfig, tableIdent } from "./internal";

// ─── Backup / restore ───────────────────────────────────────────────────

/**
 * Format a single value into a SQL literal. The dump query casts every
 * column to `::text`, so the driver hands us either null or a string that is
 * already Postgres's canonical text representation. We just NULL-guard and
 * quote/escape — implicit text→type coercion on INSERT does the rest, which
 * round-trips int / numeric / text / uuid / timestamp / bool / json / jsonb /
 * arrays / bytea correctly.
 */
function sqlTextLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

export interface DumpOptions {
  /** Restrict to these schemas; default = all non-system schemas. */
  schemas?: string[];
  /** When false, emit DDL only (no INSERT rows). */
  includeData?: boolean;
  /** Rows per multi-row INSERT batch. */
  batchSize?: number;
}

/**
 * Streams a portable SQL dump of `database` as an async generator of string
 * chunks. The output is a single transaction: schema DDL (CREATE TABLE +
 * indexes) followed by batched multi-row INSERTs. Restorable by executing
 * the file through {@link restoreSql} or `psql -f`.
 *
 * Memory stays bounded: tables are read in keyset-free OFFSET batches and
 * yielded incrementally rather than buffered.
 */
export async function* streamDatabaseDump(
  config: PostgresConfig,
  database: string,
  options: DumpOptions = {},
): AsyncGenerator<string> {
  const includeData = options.includeData ?? true;
  const batchSize = Math.min(Math.max(options.batchSize ?? 1000, 1), 10_000);

  const { Client } = await getPg();
  const client: PgClient = new Client(
    buildClientConfig(config, database, { statementTimeoutMs: 0 }),
  );
  await client.connect();
  try {
    // Resolve target schemas.
    const schemaRows = await client.query<{ nspname: string }>(
      `select nspname from pg_namespace
       where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
         and nspname not like 'pg_temp_%' and nspname not like 'pg_toast_temp_%'
       order by nspname`,
    );
    let schemas = schemaRows.rows.map((r) => r.nspname);
    if (options.schemas && options.schemas.length > 0) {
      const want = new Set(options.schemas);
      schemas = schemas.filter((s) => want.has(s));
    }

    const stamp = new Date().toISOString();
    yield `-- Baklava SQL dump\n-- database: ${database}\n-- generated: ${stamp}\n-- schemas: ${schemas.join(", ") || "(none)"}\n\n`;
    yield `BEGIN;\n\n`;

    // The dump is emitted in three sections so foreign keys never constrain
    // restore order (the pg_dump model): tables WITHOUT their FKs, then all
    // data, then the FKs added back via ALTER TABLE. Data can therefore load
    // in any table order — a child can be inserted before its parent because
    // no FK is enforced yet.
    interface TablePlan {
      schema: string;
      table: string;
      cols: string[];
    }
    const tablePlans: TablePlan[] = [];
    // Deferred FK statements, emitted after all data.
    const fkStatements: string[] = [];
    // setval() statements, emitted at the very end.
    const setvalStatements: string[] = [];

    // ── Section 1: schemas, sequences, tables (sans FK), indexes ──────────
    for (const schema of schemas) {
      if (schema !== "public") {
        yield `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)};\n\n`;
      }

      // Sequences first — serial/bigserial/identity columns expand to a
      // DEFAULT nextval('…_seq'), so the sequence must exist before the
      // tables that reference it.
      const seqRows = await client.query<{
        sequencename: string;
        last_value: string | null;
      }>(
        `select sequencename, last_value
         from pg_sequences where schemaname = $1
         order by sequencename`,
        [schema],
      );
      for (const s of seqRows.rows) {
        yield `CREATE SEQUENCE IF NOT EXISTS ${quoteIdent(schema)}.${quoteIdent(s.sequencename)};\n`;
        if (includeData && s.last_value != null) {
          setvalStatements.push(
            `SELECT setval('${schema.replace(/'/g, "''")}.${s.sequencename.replace(/'/g, "''")}', ${s.last_value}, true);`,
          );
        }
      }
      if (seqRows.rows.length > 0) yield `\n`;

      // Ordinary tables only (skip views / matviews).
      const tableRows = await client.query<{ relname: string }>(
        `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = $1 and c.relkind = 'r'
         order by c.relname`,
        [schema],
      );

      for (const { relname: table } of tableRows.rows) {
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

        // Split constraints: FKs are deferred to section 3; everything else
        // (PRIMARY KEY / UNIQUE / CHECK / EXCLUDE) stays inline.
        const inlineConstraints = constraints.filter(
          (c) => c.type !== "FOREIGN KEY",
        );
        const constraintLines = inlineConstraints.map(
          (c) => `  CONSTRAINT ${quoteIdent(c.name)} ${c.definition}`,
        );
        for (const fk of constraints.filter((c) => c.type === "FOREIGN KEY")) {
          fkStatements.push(
            `ALTER TABLE ${tableIdent(schema, table)} ADD CONSTRAINT ${quoteIdent(fk.name)} ${fk.definition};`,
          );
        }

        const create = `CREATE TABLE ${tableIdent(schema, table)} (\n${[...colLines, ...constraintLines].join(",\n")}\n);`;

        // Skip indexes that back a constraint we already emitted inline.
        const constraintNames = new Set(inlineConstraints.map((c) => c.name));
        const indexLines = indexes
          .filter((i) => !i.isPrimary && !constraintNames.has(i.name))
          .map((i) => (i.definition.endsWith(";") ? i.definition : i.definition + ";"));

        yield `-- table ${schema}.${table}\n${[create, ...indexLines].join("\n\n")}\n\n`;

        tablePlans.push({
          schema,
          table,
          cols: columns.map((c) => c.name),
        });
      }
    }

    // ── Section 2: data (any order — FKs aren't enforced yet) ─────────────
    if (includeData) {
      for (const plan of tablePlans) {
        if (plan.cols.length === 0) continue;
        const colList = plan.cols.map((c) => quoteIdent(c)).join(", ");
        // Cast every column to text so the driver returns Postgres's own
        // canonical output form (arrays as {a,b}, jsonb as compact JSON,
        // bytea as \x…). Every value re-parses on INSERT via implicit
        // text→type coercion.
        const selectList = plan.cols
          .map((c) => `${quoteIdent(c)}::text`)
          .join(", ");
        const fqn = `${quoteIdent(plan.schema)}.${quoteIdent(plan.table)}`;

        let offset = 0;
        let wroteAny = false;
        for (;;) {
          const batch = await client.query({
            text: `SELECT ${selectList} FROM ${fqn} LIMIT ${batchSize} OFFSET ${offset}`,
            rowMode: "array",
          });
          if (batch.rows.length === 0) break;
          if (!wroteAny) {
            yield `-- data ${plan.schema}.${plan.table}\n`;
            wroteAny = true;
          }
          const values = (batch.rows as unknown[][])
            .map((row) => `  (${row.map(sqlTextLiteral).join(", ")})`)
            .join(",\n");
          yield `INSERT INTO ${fqn} (${colList}) VALUES\n${values};\n`;
          offset += batch.rows.length;
          if (batch.rows.length < batchSize) break;
        }
        if (wroteAny) yield `\n`;
      }
    }

    // ── Section 3: foreign keys + sequence resync ─────────────────────────
    if (fkStatements.length > 0) {
      yield `-- foreign keys\n${fkStatements.join("\n")}\n\n`;
    }
    if (setvalStatements.length > 0) {
      yield `-- sequence resync\n${setvalStatements.join("\n")}\n\n`;
    }

    yield `COMMIT;\n`;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface RestoreResult {
  ok: boolean;
  statementsRun: number;
  error?: string;
}

/**
 * Restore by executing an uploaded SQL dump through a single connection so
 * the dump's own BEGIN/COMMIT bracket works. We feed the whole script via
 * the simple-query protocol (pg runs all statements). On error nothing is
 * committed because the dump wraps itself in a transaction.
 */
export async function restoreSql(
  config: PostgresConfig,
  database: string,
  sql: string,
): Promise<RestoreResult> {
  const { Client } = await getPg();
  const client: PgClient = new Client(
    buildClientConfig(config, database, { statementTimeoutMs: 0 }),
  );
  await client.connect();
  try {
    await client.query(sql);
    // Best-effort statement count for the UI.
    const statementsRun = (sql.match(/;\s*$/gm) ?? []).length;
    return { ok: true, statementsRun };
  } catch (err) {
    // If the dump didn't wrap itself in a transaction, try a rollback so a
    // partial restore doesn't linger in an aborted-transaction state.
    await client.query("ROLLBACK").catch(() => undefined);
    return {
      ok: false,
      statementsRun: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
