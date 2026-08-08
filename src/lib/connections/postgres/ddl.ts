/**
 * Postgres driver — DDL: tables, sequences, functions, indexes, views,
 * databases, schemas, ALTER TABLE, extensions.
 */
import type { PostgresConfig } from "../types";
import { withClient } from "./client";
import { quoteIdent, validateIdentifier, requireNoStatementTerminator } from "./sql";
import { tableIdent } from "./internal";

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
    const parts = [
      quoteIdent(c.name.trim()),
      requireNoStatementTerminator(c.dataType.trim(), "Column type"),
    ];
    if (!c.nullable) parts.push("NOT NULL");
    if (c.default && c.default.trim()) {
      parts.push(
        `DEFAULT ${requireNoStatementTerminator(c.default.trim(), "Default expression")}`,
      );
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

export interface SequenceOptions {
  start?: string;
  increment?: string;
  minValue?: string | null; // null clears (NO MINVALUE)
  maxValue?: string | null; // null clears (NO MAXVALUE)
  cache?: string;
  cycle?: boolean;
}

function buildSequenceClauses(opts: SequenceOptions): string[] {
  const parts: string[] = [];
  const numeric = (v: string) => {
    if (!/^-?\d+$/.test(v.trim())) {
      throw new Error(`Expected integer, got "${v}"`);
    }
    return v.trim();
  };
  if (opts.start !== undefined) parts.push(`START WITH ${numeric(opts.start)}`);
  if (opts.increment !== undefined)
    parts.push(`INCREMENT BY ${numeric(opts.increment)}`);
  if (opts.minValue !== undefined) {
    parts.push(opts.minValue === null ? "NO MINVALUE" : `MINVALUE ${numeric(opts.minValue)}`);
  }
  if (opts.maxValue !== undefined) {
    parts.push(opts.maxValue === null ? "NO MAXVALUE" : `MAXVALUE ${numeric(opts.maxValue)}`);
  }
  if (opts.cache !== undefined) parts.push(`CACHE ${numeric(opts.cache)}`);
  if (opts.cycle !== undefined) parts.push(opts.cycle ? "CYCLE" : "NO CYCLE");
  return parts;
}

export async function createSequence(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  opts: SequenceOptions = {},
): Promise<void> {
  const trimmed = validateIdentifier(name, "Sequence");
  const clauses = buildSequenceClauses(opts);
  const sql = `CREATE SEQUENCE ${quoteIdent(schema)}.${quoteIdent(trimmed)}${
    clauses.length ? " " + clauses.join(" ") : ""
  }`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function alterSequence(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  opts: SequenceOptions,
): Promise<void> {
  const clauses = buildSequenceClauses(opts);
  if (clauses.length === 0) throw new Error("No changes to apply");
  const sql = `ALTER SEQUENCE ${quoteIdent(schema)}.${quoteIdent(name)} ${clauses.join(" ")}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropSequence(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  options?: { cascade?: boolean; ifExists?: boolean },
): Promise<void> {
  const sql = `DROP SEQUENCE ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(schema)}.${quoteIdent(name)}${options?.cascade ? " CASCADE" : ""}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

/**
 * Execute a CREATE FUNCTION (or CREATE OR REPLACE FUNCTION) statement verbatim.
 * The caller is responsible for the SQL; we only check that it begins with the
 * expected keyword to avoid arbitrary script execution.
 */
export async function createOrReplaceFunction(
  config: PostgresConfig,
  database: string,
  sql: string,
): Promise<void> {
  const trimmed = sql.trim().replace(/;+\s*$/g, "");
  if (!/^create\s+(or\s+replace\s+)?(procedure|function)\b/i.test(trimmed)) {
    throw new Error(
      "SQL must begin with CREATE [OR REPLACE] FUNCTION or PROCEDURE",
    );
  }
  await withClient(config, database, async (client) => {
    await client.query(trimmed);
  });
}

export async function dropFunction(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  argSignature: string,
  options?: { cascade?: boolean; ifExists?: boolean; isProcedure?: boolean },
): Promise<void> {
  const kind = options?.isProcedure ? "PROCEDURE" : "FUNCTION";
  const safeArgs = requireNoStatementTerminator(
    argSignature,
    "Function argument signature",
  );
  const sql = `DROP ${kind} ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(schema)}.${quoteIdent(name)}(${safeArgs})${options?.cascade ? " CASCADE" : ""}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

/**
 * Execute CREATE [OR REPLACE] [MATERIALIZED] VIEW verbatim. Refuses anything
 * else so the endpoint can't run arbitrary SQL.
 */
export interface CreateIndexInput {
  /** Optional; Postgres auto-generates a name when omitted. */
  name?: string;
  /** Column expressions (will be quoted as identifiers when alphanumeric). */
  columns: string[];
  unique?: boolean;
  method?: "btree" | "hash" | "gin" | "gist" | "brin" | "spgist";
  /** Optional WHERE for a partial index. */
  where?: string;
  /** CONCURRENTLY — non-blocking but cannot run inside a transaction. */
  concurrent?: boolean;
}

const INDEX_METHODS = new Set([
  "btree",
  "hash",
  "gin",
  "gist",
  "brin",
  "spgist",
]);

function quoteIndexColumn(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error("Column expression is required");
  // If it looks like a bare identifier, quote it; otherwise treat as a raw
  // expression (e.g. `lower(email)`).
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return quoteIdent(trimmed);
  }
  return trimmed;
}

export async function createIndex(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  input: CreateIndexInput,
): Promise<void> {
  if (!input.columns || input.columns.length === 0) {
    throw new Error("At least one column is required");
  }
  if (input.method && !INDEX_METHODS.has(input.method)) {
    throw new Error(`Unknown index method: ${input.method}`);
  }
  const parts: string[] = ["CREATE"];
  if (input.unique) parts.push("UNIQUE");
  parts.push("INDEX");
  if (input.concurrent) parts.push("CONCURRENTLY");
  if (input.name) {
    parts.push(validateIdentifier(input.name, "Index"));
  }
  parts.push("ON", tableIdent(schema, table));
  if (input.method) parts.push(`USING ${input.method}`);
  parts.push(`(${input.columns.map(quoteIndexColumn).join(", ")})`);
  if (input.where && input.where.trim()) {
    parts.push(
      `WHERE ${requireNoStatementTerminator(input.where.trim(), "WHERE clause")}`,
    );
  }
  const sql = parts.join(" ");
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropIndex(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  options?: { cascade?: boolean; ifExists?: boolean; concurrent?: boolean },
): Promise<void> {
  const sql = `DROP INDEX ${options?.concurrent ? "CONCURRENTLY " : ""}${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(schema)}.${quoteIdent(name)}${options?.cascade ? " CASCADE" : ""}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function renameIndex(
  config: PostgresConfig,
  database: string,
  schema: string,
  name: string,
  newName: string,
): Promise<void> {
  const trimmed = validateIdentifier(newName, "Index");
  const sql = `ALTER INDEX ${quoteIdent(schema)}.${quoteIdent(name)} RENAME TO ${quoteIdent(trimmed)}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function createOrReplaceView(
  config: PostgresConfig,
  database: string,
  sql: string,
): Promise<void> {
  const trimmed = sql.trim().replace(/;+\s*$/g, "");
  if (
    !/^create\s+(or\s+replace\s+)?(materialized\s+)?view\b/i.test(trimmed)
  ) {
    throw new Error(
      "SQL must begin with CREATE [OR REPLACE] [MATERIALIZED] VIEW",
    );
  }
  await withClient(config, database, async (client) => {
    await client.query(trimmed);
  });
}

export async function createDatabase(
  config: PostgresConfig,
  name: string,
  options?: { ifNotExists?: boolean; owner?: string; encoding?: string; template?: string },
): Promise<void> {
  const trimmed = validateIdentifier(name, "Database");
  const parts = [`CREATE DATABASE ${quoteIdent(trimmed)}`];
  if (options?.owner && options.owner.trim()) {
    parts.push(`OWNER ${quoteIdent(options.owner.trim())}`);
  }
  if (options?.template && options.template.trim()) {
    parts.push(`TEMPLATE ${quoteIdent(options.template.trim())}`);
  }
  if (options?.encoding && options.encoding.trim()) {
    parts.push(`ENCODING ${quoteIdent(options.encoding.trim())}`);
  }
  await withClient(config, undefined, async (client) => {
    await client.query(parts.join(" "));
  });
}

export async function dropDatabase(
  config: PostgresConfig,
  name: string,
  options?: { ifExists?: boolean; force?: boolean },
): Promise<void> {
  // Connect to a database that isn't the target. Default config DB usually works,
  // but if the caller asked to drop *that* one, fall back to "postgres".
  const fallback =
    config.database && config.database !== name ? config.database : "postgres";
  const sql = `DROP DATABASE ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(name)}${options?.force ? " WITH (FORCE)" : ""}`;
  const conn: PostgresConfig = { ...config, database: fallback };
  await withClient(conn, fallback, async (client) => {
    await client.query(sql);
  });
}

export async function createSchema(
  config: PostgresConfig,
  database: string,
  name: string,
  options?: { ifNotExists?: boolean }
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Schema name is required");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(
      "Schema name must start with a letter or underscore and contain only letters, numbers, and underscores"
    );
  }
  const sql = `CREATE SCHEMA ${options?.ifNotExists ? "IF NOT EXISTS " : ""}${quoteIdent(trimmed)}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropSchema(
  config: PostgresConfig,
  database: string,
  schema: string,
  options?: { cascade?: boolean; ifExists?: boolean }
): Promise<void> {
  const sql = `DROP SCHEMA ${options?.ifExists ? "IF EXISTS " : ""}${quoteIdent(schema)}${options?.cascade ? " CASCADE" : " RESTRICT"}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropTable(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  options?: { cascade?: boolean; ifExists?: boolean }
): Promise<void> {
  const sql = `DROP TABLE ${options?.ifExists ? "IF EXISTS " : ""}${tableIdent(schema, table)}${options?.cascade ? " CASCADE" : " RESTRICT"}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export async function dropView(
  config: PostgresConfig,
  database: string,
  schema: string,
  view: string,
  options?: { cascade?: boolean; ifExists?: boolean; materialized?: boolean }
): Promise<void> {
  const kind = options?.materialized ? "MATERIALIZED VIEW" : "VIEW";
  const sql = `DROP ${kind} ${options?.ifExists ? "IF EXISTS " : ""}${tableIdent(schema, view)}${options?.cascade ? " CASCADE" : " RESTRICT"}`;
  await withClient(config, database, async (client) => {
    await client.query(sql);
  });
}

export type AlterTableOp =
  | { kind: "addColumn"; name: string; dataType: string; nullable: boolean; default?: string }
  | { kind: "dropColumn"; name: string; cascade?: boolean }
  | { kind: "renameColumn"; from: string; to: string }
  | { kind: "alterType"; name: string; dataType: string; using?: string }
  | { kind: "setDefault"; name: string; default: string }
  | { kind: "dropDefault"; name: string }
  | { kind: "setNotNull"; name: string }
  | { kind: "dropNotNull"; name: string };

function buildAlterClause(schema: string, table: string, op: AlterTableOp): string {
  const t = tableIdent(schema, table);
  switch (op.kind) {
    case "addColumn": {
      if (!op.name.trim()) throw new Error("Column name is required");
      if (!op.dataType.trim()) throw new Error("Column type is required");
      const dataType = requireNoStatementTerminator(op.dataType.trim(), "Column type");
      const parts = [`ALTER TABLE ${t} ADD COLUMN ${quoteIdent(op.name.trim())} ${dataType}`];
      if (!op.nullable) parts.push("NOT NULL");
      if (op.default && op.default.trim()) {
        const def = requireNoStatementTerminator(op.default.trim(), "Default expression");
        parts.push(`DEFAULT ${def}`);
      }
      return parts.join(" ");
    }
    case "dropColumn":
      return `ALTER TABLE ${t} DROP COLUMN ${quoteIdent(op.name)}${op.cascade ? " CASCADE" : ""}`;
    case "renameColumn":
      if (!op.to.trim()) throw new Error("New column name is required");
      return `ALTER TABLE ${t} RENAME COLUMN ${quoteIdent(op.from)} TO ${quoteIdent(op.to.trim())}`;
    case "alterType": {
      if (!op.dataType.trim()) throw new Error("New type is required");
      const dataType = requireNoStatementTerminator(op.dataType.trim(), "Column type");
      const using =
        op.using && op.using.trim()
          ? ` USING ${requireNoStatementTerminator(op.using.trim(), "USING expression")}`
          : "";
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} TYPE ${dataType}${using}`;
    }
    case "setDefault": {
      if (!op.default.trim()) throw new Error("Default expression is required");
      const def = requireNoStatementTerminator(op.default.trim(), "Default expression");
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} SET DEFAULT ${def}`;
    }
    case "dropDefault":
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} DROP DEFAULT`;
    case "setNotNull":
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} SET NOT NULL`;
    case "dropNotNull":
      return `ALTER TABLE ${t} ALTER COLUMN ${quoteIdent(op.name)} DROP NOT NULL`;
  }
}

export async function alterTable(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  ops: AlterTableOp[]
): Promise<{ statements: string[] }> {
  if (ops.length === 0) throw new Error("No changes to apply");
  const statements = ops.map((op) => buildAlterClause(schema, table, op));
  await withClient(config, database, async (client) => {
    await client.query("BEGIN");
    try {
      for (const stmt of statements) {
        await client.query(stmt);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  });
  return { statements };
}

// ─── Extension manager ────────────────────────────────────────────────────

export interface InstalledExtension {
  name: string;
  schema: string;
  installedVersion: string;
  defaultVersion: string | null;
  /** True when installedVersion !== defaultVersion. */
  updateAvailable: boolean;
  comment: string | null;
}

export interface AvailableExtension {
  name: string;
  defaultVersion: string | null;
  comment: string | null;
}

export interface ExtensionsListing {
  installed: InstalledExtension[];
  available: AvailableExtension[];
}

export async function listExtensions(
  config: PostgresConfig,
  database: string,
): Promise<ExtensionsListing> {
  return withClient(config, database, async (client) => {
    const [installed, available] = await Promise.all([
      client.query<{
        name: string;
        schema: string;
        installed_version: string;
        default_version: string | null;
        comment: string | null;
      }>(
        `select e.extname as name,
                n.nspname as schema,
                e.extversion as installed_version,
                a.default_version,
                a.comment
         from pg_extension e
         join pg_namespace n on n.oid = e.extnamespace
         left join pg_available_extensions a on a.name = e.extname
         order by e.extname`,
      ),
      client.query<{
        name: string;
        default_version: string | null;
        comment: string | null;
      }>(
        `select name, default_version, comment
         from pg_available_extensions
         where installed_version is null
         order by name`,
      ),
    ]);

    return {
      installed: installed.rows.map((r) => ({
        name: r.name,
        schema: r.schema,
        installedVersion: r.installed_version,
        defaultVersion: r.default_version,
        updateAvailable:
          r.default_version != null &&
          r.default_version !== r.installed_version,
        comment: r.comment,
      })),
      available: available.rows.map((r) => ({
        name: r.name,
        defaultVersion: r.default_version,
        comment: r.comment,
      })),
    };
  });
}

export async function createExtension(
  config: PostgresConfig,
  database: string,
  name: string,
  opts: { cascade?: boolean; schema?: string } = {},
): Promise<void> {
  validateIdentifier(name, "extension");
  if (opts.schema) validateIdentifier(opts.schema, "schema");
  await withClient(config, database, async (client) => {
    const parts = [`create extension if not exists ${quoteIdent(name)}`];
    if (opts.schema) parts.push(`schema ${quoteIdent(opts.schema)}`);
    if (opts.cascade) parts.push("cascade");
    await client.query(parts.join(" "));
  });
}

export async function dropExtension(
  config: PostgresConfig,
  database: string,
  name: string,
  opts: { cascade?: boolean } = {},
): Promise<void> {
  validateIdentifier(name, "extension");
  await withClient(config, database, async (client) => {
    const sql = `drop extension ${quoteIdent(name)}${opts.cascade ? " cascade" : ""}`;
    await client.query(sql);
  });
}

export async function updateExtension(
  config: PostgresConfig,
  database: string,
  name: string,
): Promise<void> {
  validateIdentifier(name, "extension");
  await withClient(config, database, async (client) => {
    await client.query(`alter extension ${quoteIdent(name)} update`);
  });
}

