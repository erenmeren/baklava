/**
 * SQL Server driver — DDL (create / drop / alter database, schema, table,
 * sequence, synonym, type, table-type; arbitrary CREATE scripts).
 *
 * Each helper whitelists identifiers (schema, name, column names) and rejects
 * `;` from free-form fragments (data types, default expressions, synonym
 * targets) — mirroring the createSqlServerTable pattern. The exception is
 * `executeSqlServerDdl`, which runs an arbitrary user-authored CREATE batch
 * (the "Script CREATE To" pattern from SSMS) and is intentionally
 * unrestricted — same trust model as the SQL query editor.
 */
import type { SqlServerConfig } from "../types";
import { withPool } from "./internal";
import {
  validateSqlServerIdentifier,
  validateSqlServerDatabaseName,
  requireNoStatementTerminator,
} from "./sql";

export interface CreateSqlServerColumnInput {
  name: string;
  dataType: string;
  nullable: boolean;
  default?: string;
  isPrimaryKey: boolean;
  identity: boolean;
}

export interface CreateSqlServerTableInput {
  schema: string;
  name: string;
  columns: CreateSqlServerColumnInput[];
  ifNotExists?: boolean;
}

/**
 * Build + run a `CREATE TABLE [schema].[table] (...)`. Identifiers (schema /
 * table / column) are whitelisted then bracket-quoted; column types and
 * DEFAULT expressions are free-form fragments guarded against `;`.
 */
export async function createSqlServerTable(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerTableInput
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Table name is required");
  const table = validateSqlServerIdentifier(input.name.trim(), "table name");
  if (!input.columns.length) throw new Error("At least one column is required");

  const seen = new Set<string>();
  const colDefs = input.columns.map((c) => {
    const name = validateSqlServerIdentifier(c.name.trim(), "column name");
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate column name "${name}"`);
    seen.add(key);
    if (!c.dataType.trim()) throw new Error(`Column "${name}" needs a data type`);

    const parts = [`[${name}]`, requireNoStatementTerminator(c.dataType.trim(), "Column type")];
    if (c.identity) parts.push("IDENTITY(1,1)");
    parts.push(c.nullable ? "NULL" : "NOT NULL");
    if (c.default && c.default.trim()) {
      parts.push(`DEFAULT (${requireNoStatementTerminator(c.default.trim(), "Default expression")})`);
    }
    return parts.join(" ");
  });

  const pkCols = input.columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length) {
    const cols = pkCols
      .map((c) => `[${validateSqlServerIdentifier(c.name.trim(), "column name")}]`)
      .join(", ");
    colDefs.push(`PRIMARY KEY (${cols})`);
  }

  const create = `CREATE TABLE [${schema}].[${table}] (\n  ${colDefs.join(",\n  ")}\n)`;
  // No native CREATE TABLE IF NOT EXISTS in T-SQL — guard with OBJECT_ID. The
  // identifiers are whitelisted alnum/underscore, so embedding them in the
  // N'…' literal can't break out of the string.
  const sql = input.ifNotExists
    ? `IF OBJECT_ID(N'[${schema}].[${table}]', N'U') IS NULL\n${create}`
    : create;

  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database }
  );
}

/**
 * Create a database. Runs `CREATE DATABASE [name]` against `master`. The name
 * is whitelisted to the regular-identifier alphabet (letters/digits/underscore)
 * before being spliced into the bracketed identifier — `]` injection is
 * therefore impossible, which is the same guard `USE [name]` relies on.
 */
export async function createSqlServerDatabase(
  config: SqlServerConfig,
  name: string
): Promise<void> {
  validateSqlServerDatabaseName(name);
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(`CREATE DATABASE [${name}]`);
    },
    { database: "master" }
  );
}

/**
 * Drop a database. Runs on `master`. With `force`, first flips the database to
 * SINGLE_USER WITH ROLLBACK IMMEDIATE to terminate active connections (SQL
 * Server refuses DROP DATABASE while sessions are connected) — the analogue of
 * Postgres's "force / terminate connections".
 */
export async function dropSqlServerDatabase(
  config: SqlServerConfig,
  name: string,
  opts?: { force?: boolean }
): Promise<void> {
  validateSqlServerDatabaseName(name);
  const sql = opts?.force
    ? `ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}];`
    : `DROP DATABASE [${name}]`;
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database: "master" }
  );
}

/** Drop a schema (must be empty — SQL Server has no cascading DROP SCHEMA). */
export async function dropSqlServerSchema(
  config: SqlServerConfig,
  database: string,
  schema: string
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(`DROP SCHEMA [${schema}]`);
    },
    { database }
  );
}

const DROP_KEYWORD: Record<string, string> = {
  table: "TABLE",
  view: "VIEW",
  proc: "PROCEDURE",
  scalar_fn: "FUNCTION",
  table_fn: "FUNCTION",
  trigger: "TRIGGER",
  synonym: "SYNONYM",
  sequence: "SEQUENCE",
  type: "TYPE",
  table_type: "TYPE",
};

/** Drop a schema-scoped object (table / view / proc / function / trigger / synonym). */
export async function dropSqlServerObject(
  config: SqlServerConfig,
  database: string,
  object: { schema: string; name: string; kind: string }
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(object.schema, "schema name");
  const name = validateSqlServerIdentifier(object.name, "object name");
  const keyword = DROP_KEYWORD[object.kind];
  if (!keyword) throw new Error(`Cannot drop object of kind "${object.kind}"`);
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(`DROP ${keyword} [${schema}].[${name}]`);
    },
    { database }
  );
}

/**
 * Create a schema in `database`. `CREATE SCHEMA` must be the only statement in
 * its batch, so it runs on its own. Both identifiers are whitelisted before
 * splicing (see {@link createSqlServerDatabase}).
 */
export async function createSqlServerSchema(
  config: SqlServerConfig,
  database: string,
  schema: string
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(`CREATE SCHEMA [${schema}]`);
    },
    { database }
  );
}

// ─── Alter table (add / drop / rename / change column) ──────────────────
//
// Mirrors the Postgres ALTER pipeline (modify-table-dialog → PATCH route).
// Each op is one T-SQL statement; all of them run inside a single
// transaction so partial failures roll back cleanly.
//
// T-SQL quirks worth noting:
// - Adding a column uses `ADD` (no `COLUMN` keyword).
// - Renaming uses sp_rename — no native `RENAME COLUMN` syntax.
// - ALTER COLUMN must re-state the type even when only nullability is
//   changing, so this driver collapses "type + nullable" into one op
//   (alterColumn) rather than Postgres's split setNotNull/dropNotNull.

export type SqlServerAlterTableOp =
  | {
      kind: "addColumn";
      name: string;
      dataType: string;
      nullable: boolean;
      default?: string;
    }
  | { kind: "dropColumn"; name: string }
  | { kind: "renameColumn"; from: string; to: string }
  | {
      kind: "alterColumn";
      name: string;
      dataType: string;
      nullable: boolean;
    };

function alterTableSql(
  database: string,
  schema: string,
  table: string,
  op: SqlServerAlterTableOp,
): string {
  const fqn = `[${database}].[${schema}].[${table}]`;
  switch (op.kind) {
    case "addColumn": {
      const col = validateSqlServerIdentifier(op.name, "column name");
      const t = requireNoStatementTerminator(op.dataType.trim(), "Column type");
      const parts = [`ALTER TABLE ${fqn} ADD [${col}] ${t}`];
      parts.push(op.nullable ? "NULL" : "NOT NULL");
      if (op.default && op.default.trim()) {
        parts.push(
          `DEFAULT (${requireNoStatementTerminator(op.default.trim(), "Default expression")})`,
        );
      }
      return parts.join(" ");
    }
    case "dropColumn": {
      const col = validateSqlServerIdentifier(op.name, "column name");
      return `ALTER TABLE ${fqn} DROP COLUMN [${col}]`;
    }
    case "renameColumn": {
      const from = validateSqlServerIdentifier(op.from, "column name");
      const to = validateSqlServerIdentifier(op.to, "column name");
      // sp_rename is a stored proc — we send the qualifier as an N'…'
      // literal. The pieces are alnum/underscore via the validator so
      // they can't break out of the string literal.
      return `EXEC sp_rename N'${schema}.${table}.${from}', N'${to}', N'COLUMN'`;
    }
    case "alterColumn": {
      const col = validateSqlServerIdentifier(op.name, "column name");
      const t = requireNoStatementTerminator(op.dataType.trim(), "Column type");
      return `ALTER TABLE ${fqn} ALTER COLUMN [${col}] ${t} ${
        op.nullable ? "NULL" : "NOT NULL"
      }`;
    }
  }
}

export async function alterSqlServerTable(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  ops: SqlServerAlterTableOp[],
): Promise<{ applied: number }> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(table, "table name");
  if (ops.length === 0) return { applied: 0 };

  // Order: DROP → ALTER → RENAME → ADD. Same shape as the Postgres
  // pipeline so a sequence of changes from one form submission applies
  // in a sensible order (drops free up names before adds, renames after
  // any column-level alters so we still reference the original name).
  const drops = ops.filter((o) => o.kind === "dropColumn");
  const alters = ops.filter((o) => o.kind === "alterColumn");
  const renames = ops.filter((o) => o.kind === "renameColumn");
  const adds = ops.filter((o) => o.kind === "addColumn");
  const ordered = [...drops, ...alters, ...renames, ...adds];

  const sql = [
    "BEGIN TRANSACTION;",
    ...ordered.map((op) => alterTableSql(database, schema, table, op) + ";"),
    "COMMIT TRANSACTION;",
  ].join("\n");

  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database },
  );
  return { applied: ordered.length };
}

// ─── Create: sequence / synonym / type / table-type / arbitrary DDL ──────

const SEQUENCE_TYPE_RE = /^(bigint|int|smallint|tinyint|decimal\([\s\d,]+\)|numeric\([\s\d,]+\))$/i;
const INTEGER_RE = /^-?\d+$/;

export interface CreateSqlServerSequenceInput {
  schema: string;
  name: string;
  /** bigint (default) | int | smallint | tinyint | decimal(p,0) | numeric(p,0) */
  dataType?: string;
  startWith?: string;
  incrementBy?: string;
  /** null → NO MINVALUE; undefined → omit (server default) */
  minValue?: string | null;
  /** null → NO MAXVALUE; undefined → omit (server default) */
  maxValue?: string | null;
  /** true → CYCLE; false → NO CYCLE; undefined → omit */
  cycle?: boolean;
  /** number → CACHE n; null → NO CACHE; undefined → omit */
  cache?: number | null;
}

export async function createSqlServerSequence(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerSequenceInput,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Sequence name is required");
  const name = validateSqlServerIdentifier(input.name.trim(), "sequence name");

  const parts: string[] = [`CREATE SEQUENCE [${schema}].[${name}]`];
  if (input.dataType && input.dataType.trim()) {
    const t = input.dataType.trim();
    if (!SEQUENCE_TYPE_RE.test(t)) throw new Error(`Invalid sequence data type "${t}"`);
    parts.push(`AS ${t}`);
  }
  if (input.startWith && input.startWith.trim()) {
    if (!INTEGER_RE.test(input.startWith.trim())) throw new Error("START WITH must be an integer");
    parts.push(`START WITH ${input.startWith.trim()}`);
  }
  if (input.incrementBy && input.incrementBy.trim()) {
    if (!INTEGER_RE.test(input.incrementBy.trim())) throw new Error("INCREMENT BY must be an integer");
    parts.push(`INCREMENT BY ${input.incrementBy.trim()}`);
  }
  if (input.minValue !== undefined) {
    if (input.minValue === null) parts.push("NO MINVALUE");
    else {
      if (!INTEGER_RE.test(input.minValue.trim())) throw new Error("MINVALUE must be an integer");
      parts.push(`MINVALUE ${input.minValue.trim()}`);
    }
  }
  if (input.maxValue !== undefined) {
    if (input.maxValue === null) parts.push("NO MAXVALUE");
    else {
      if (!INTEGER_RE.test(input.maxValue.trim())) throw new Error("MAXVALUE must be an integer");
      parts.push(`MAXVALUE ${input.maxValue.trim()}`);
    }
  }
  if (input.cycle === true) parts.push("CYCLE");
  else if (input.cycle === false) parts.push("NO CYCLE");
  if (input.cache !== undefined) {
    if (input.cache === null) parts.push("NO CACHE");
    else {
      if (!Number.isInteger(input.cache) || input.cache < 0) {
        throw new Error("CACHE must be a non-negative integer");
      }
      parts.push(`CACHE ${input.cache}`);
    }
  }

  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(parts.join(" "));
    },
    { database },
  );
}

export interface CreateSqlServerSynonymInput {
  schema: string;
  name: string;
  /** Target object reference, e.g. `[db].[schema].[obj]` or `db.schema.obj`. */
  target: string;
}

export async function createSqlServerSynonym(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerSynonymInput,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Synonym name is required");
  const name = validateSqlServerIdentifier(input.name.trim(), "synonym name");
  if (!input.target.trim()) throw new Error("Target object is required");
  // Targets are 1- to 4-part references with brackets/dots; `;` is the only
  // character that lets a second statement piggyback, so block it.
  const target = requireNoStatementTerminator(input.target.trim(), "Target");

  await withPool(
    config,
    async (pool) => {
      await pool
        .request()
        .batch(`CREATE SYNONYM [${schema}].[${name}] FOR ${target}`);
    },
    { database },
  );
}

export interface CreateSqlServerTypeInput {
  schema: string;
  name: string;
  /** Base type, e.g. `nvarchar(50)`, `decimal(18,2)`, `int`. */
  baseType: string;
  nullable: boolean;
}

export async function createSqlServerType(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerTypeInput,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Type name is required");
  const name = validateSqlServerIdentifier(input.name.trim(), "type name");
  if (!input.baseType.trim()) throw new Error("Base type is required");
  const baseType = requireNoStatementTerminator(input.baseType.trim(), "Base type");
  const nullability = input.nullable ? "NULL" : "NOT NULL";

  await withPool(
    config,
    async (pool) => {
      await pool
        .request()
        .batch(`CREATE TYPE [${schema}].[${name}] FROM ${baseType} ${nullability}`);
    },
    { database },
  );
}

export interface CreateSqlServerTableTypeInput {
  schema: string;
  name: string;
  columns: CreateSqlServerColumnInput[];
}

export async function createSqlServerTableType(
  config: SqlServerConfig,
  database: string,
  input: CreateSqlServerTableTypeInput,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  const schema = validateSqlServerIdentifier(input.schema, "schema name");
  if (!input.name.trim()) throw new Error("Type name is required");
  const name = validateSqlServerIdentifier(input.name.trim(), "type name");
  if (!input.columns.length) throw new Error("At least one column is required");

  const seen = new Set<string>();
  const colDefs = input.columns.map((c) => {
    const cname = validateSqlServerIdentifier(c.name.trim(), "column name");
    const key = cname.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate column name "${cname}"`);
    seen.add(key);
    if (!c.dataType.trim()) throw new Error(`Column "${cname}" needs a data type`);
    const parts = [`[${cname}]`, requireNoStatementTerminator(c.dataType.trim(), "Column type")];
    parts.push(c.nullable ? "NULL" : "NOT NULL");
    if (c.default && c.default.trim()) {
      parts.push(
        `DEFAULT (${requireNoStatementTerminator(c.default.trim(), "Default expression")})`,
      );
    }
    return parts.join(" ");
  });

  const pkCols = input.columns.filter((c) => c.isPrimaryKey);
  if (pkCols.length) {
    const cols = pkCols
      .map((c) => `[${validateSqlServerIdentifier(c.name.trim(), "column name")}]`)
      .join(", ");
    colDefs.push(`PRIMARY KEY (${cols})`);
  }

  const sql = `CREATE TYPE [${schema}].[${name}] AS TABLE (\n  ${colDefs.join(",\n  ")}\n)`;
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database },
  );
}

/**
 * Run an arbitrary single-batch DDL statement against a database. Used by the
 * "Create View / Procedure / Function / Trigger" dialogs, which let the user
 * edit a CREATE template directly — same trust model as the SQL query editor
 * (the user is intentionally authoring T-SQL).
 */
export async function executeSqlServerDdl(
  config: SqlServerConfig,
  database: string,
  sql: string,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  if (!sql.trim()) throw new Error("Script is empty");
  await withPool(
    config,
    async (pool) => {
      await pool.request().batch(sql);
    },
    { database },
  );
}
