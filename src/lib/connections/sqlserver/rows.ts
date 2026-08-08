/**
 * SQL Server driver — row CRUD (read / insert / update / delete).
 *
 * Mirrors the Postgres driver's shape so the row-form-dialog UI can share
 * types (ColumnValue / PrimaryKeyValue) without translation. Identifiers go
 * through validateSqlServerIdentifier + bracket quoting; values go through
 * mssql's parameterised .input() so they can't escape the value context.
 */
import type { SqlServerConfig } from "../types";
import { withPool } from "./internal";
import { validateSqlServerIdentifier } from "./sql";

export interface SqlServerTableData {
  fields: string[];
  rows: unknown[][];
  total: number;
}

/** Paged table data. OFFSET/FETCH needs an ORDER BY — falls back to (SELECT NULL) ordering. */
export async function getSqlServerTableData(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<SqlServerTableData> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(table, "table name");
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return withPool(
    config,
    async (pool) => {
      // 3-part naming so the query targets the right database even if the
      // global mssql pool was switched by a concurrent request between
      // withPool's connect and our query.
      const fqn = `[${database}].[${schema}].[${table}]`;
      const countR = await pool.request().query<{ n: string | number }>(
        `SELECT COUNT_BIG(*) AS n FROM ${fqn}`,
      );
      const total = Number(countR.recordset[0]?.n ?? 0);
      const dataR = await pool.request().query<Record<string, unknown>>(
        `SELECT * FROM ${fqn} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
      );
      const rs = dataR.recordset as unknown as Array<Record<string, unknown>> & {
        columns?: Record<string, unknown>;
      };
      const fields = rs.columns ? Object.keys(rs.columns) : rs[0] ? Object.keys(rs[0]) : [];
      return {
        fields,
        rows: rs.map((row) => fields.map((f) => row[f] ?? null)),
        total,
      };
    },
    { database },
  );
}

export type SqlServerColumnValue =
  | { kind: "null" }
  | { kind: "default" }
  | { kind: "value"; value: string };

export interface SqlServerPrimaryKeyValue {
  column: string;
  value: unknown;
}

export async function insertSqlServerRow(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  values: Record<string, SqlServerColumnValue>,
): Promise<{ rowsAffected: number }> {
  validateSqlServerIdentifier(database, "database name");
  const s = validateSqlServerIdentifier(schema, "schema name");
  const t = validateSqlServerIdentifier(table, "table name");

  const cols: string[] = [];
  const placeholders: string[] = [];
  const paramSpecs: Array<{ name: string; value: unknown }> = [];
  for (const [col, v] of Object.entries(values)) {
    if (v.kind === "default") continue;
    const cn = validateSqlServerIdentifier(col, "column name");
    cols.push(`[${cn}]`);
    const pName = `p${paramSpecs.length}`;
    placeholders.push(`@${pName}`);
    paramSpecs.push({
      name: pName,
      value: v.kind === "null" ? null : v.value,
    });
  }

  const sql =
    cols.length === 0
      ? `INSERT INTO [${database}].[${s}].[${t}] DEFAULT VALUES`
      : `INSERT INTO [${database}].[${s}].[${t}] (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`;

  return withPool(
    config,
    async (pool) => {
      const req = pool.request();
      for (const p of paramSpecs) req.input(p.name, p.value);
      const res = await req.query(sql);
      return { rowsAffected: res.rowsAffected[0] ?? 0 };
    },
    { database },
  );
}

export async function updateSqlServerRow(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  pk: SqlServerPrimaryKeyValue[],
  values: Record<string, SqlServerColumnValue>,
): Promise<{ rowsAffected: number }> {
  if (pk.length === 0) {
    throw new Error("Cannot update: no primary key on this table");
  }
  validateSqlServerIdentifier(database, "database name");
  const s = validateSqlServerIdentifier(schema, "schema name");
  const t = validateSqlServerIdentifier(table, "table name");

  const sets: string[] = [];
  const paramSpecs: Array<{ name: string; value: unknown }> = [];
  for (const [col, v] of Object.entries(values)) {
    if (v.kind === "default") continue;
    const cn = validateSqlServerIdentifier(col, "column name");
    const pName = `p${paramSpecs.length}`;
    sets.push(`[${cn}] = @${pName}`);
    paramSpecs.push({
      name: pName,
      value: v.kind === "null" ? null : v.value,
    });
  }
  if (sets.length === 0) throw new Error("No columns to update");

  const wheres = pk.map((item) => {
    const cn = validateSqlServerIdentifier(item.column, "primary-key column");
    const pName = `p${paramSpecs.length}`;
    paramSpecs.push({ name: pName, value: item.value });
    return `[${cn}] = @${pName}`;
  });
  const sql = `UPDATE [${database}].[${s}].[${t}] SET ${sets.join(", ")} WHERE ${wheres.join(" AND ")}`;

  return withPool(
    config,
    async (pool) => {
      const req = pool.request();
      for (const p of paramSpecs) req.input(p.name, p.value);
      const res = await req.query(sql);
      return { rowsAffected: res.rowsAffected[0] ?? 0 };
    },
    { database },
  );
}

export async function deleteSqlServerRow(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
  pk: SqlServerPrimaryKeyValue[],
): Promise<{ rowsAffected: number }> {
  if (pk.length === 0) {
    throw new Error("Cannot delete: no primary key on this table");
  }
  validateSqlServerIdentifier(database, "database name");
  const s = validateSqlServerIdentifier(schema, "schema name");
  const t = validateSqlServerIdentifier(table, "table name");

  const paramSpecs: Array<{ name: string; value: unknown }> = [];
  const wheres = pk.map((item) => {
    const cn = validateSqlServerIdentifier(item.column, "primary-key column");
    const pName = `p${paramSpecs.length}`;
    paramSpecs.push({ name: pName, value: item.value });
    return `[${cn}] = @${pName}`;
  });
  const sql = `DELETE FROM [${database}].[${s}].[${t}] WHERE ${wheres.join(" AND ")}`;

  return withPool(
    config,
    async (pool) => {
      const req = pool.request();
      for (const p of paramSpecs) req.input(p.name, p.value);
      const res = await req.query(sql);
      return { rowsAffected: res.rowsAffected[0] ?? 0 };
    },
    { database },
  );
}
