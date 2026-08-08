/**
 * Postgres driver — row-level CRUD (read a page of table data, insert,
 * update, delete a single row by primary key).
 */
import type { PostgresConfig } from "../types";
import { withClient } from "./client";
import { quoteIdent } from "./sql";
import { tableIdent } from "./internal";

const TYPE_NAMES: Record<number, string> = {
  16: "bool",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  700: "float4",
  701: "float8",
  1043: "varchar",
  1082: "date",
  1114: "timestamp",
  1184: "timestamptz",
  2950: "uuid",
  3802: "jsonb",
  114: "json",
};

function pgTypeName(oid: number): string {
  return TYPE_NAMES[oid] || `oid:${oid}`;
}

export interface TableData {
  fields: { name: string; dataType: string }[];
  rows: unknown[][];
  rowCount: number;
  totalRows: number | null;
}

export async function readTableData(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  limit: number,
  offset: number
): Promise<TableData> {
  return withClient(config, database, async (client) => {
    const ident = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    const res = await client.query({
      text: `select * from ${ident} limit $1 offset $2`,
      values: [limit, offset],
      rowMode: "array",
    });
    let totalRows: number | null = null;
    try {
      const c = await client.query<{ count: string }>(
        `select count(*)::text as count from ${ident}`
      );
      totalRows = Number(c.rows[0].count);
    } catch {
      // ignore — large tables, we already have rowEstimate
    }
    return {
      fields: res.fields.map((f) => ({
        name: f.name,
        dataType: pgTypeName(f.dataTypeID),
      })),
      rows: res.rows as unknown[][],
      rowCount: res.rowCount ?? res.rows.length,
      totalRows,
    };
  });
}

export type ColumnValue =
  | { kind: "null" }
  | { kind: "default" }
  | { kind: "value"; value: string };

export interface PrimaryKeyValue {
  column: string;
  value: unknown;
}


function paramFor(v: ColumnValue): { skip: true } | { skip: false; value: unknown } {
  if (v.kind === "default") return { skip: true };
  if (v.kind === "null") return { skip: false, value: null };
  return { skip: false, value: v.value };
}

export async function insertRow(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  values: Record<string, ColumnValue>
): Promise<{ rowsAffected: number }> {
  const cols: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];
  for (const [col, v] of Object.entries(values)) {
    const p = paramFor(v);
    if (p.skip) continue;
    cols.push(quoteIdent(col));
    params.push(p.value);
    placeholders.push(`$${params.length}`);
  }
  return withClient(config, database, async (client) => {
    const sql =
      cols.length === 0
        ? `insert into ${tableIdent(schema, table)} default values`
        : `insert into ${tableIdent(schema, table)} (${cols.join(", ")}) values (${placeholders.join(", ")})`;
    const res = await client.query(sql, params);
    return { rowsAffected: res.rowCount ?? 0 };
  });
}

export async function updateRow(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  pk: PrimaryKeyValue[],
  values: Record<string, ColumnValue>
): Promise<{ rowsAffected: number }> {
  if (pk.length === 0) {
    throw new Error("Cannot update: no primary key on this table");
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [col, v] of Object.entries(values)) {
    const p = paramFor(v);
    if (p.skip) continue;
    params.push(p.value);
    sets.push(`${quoteIdent(col)} = $${params.length}`);
  }
  if (sets.length === 0) {
    throw new Error("No columns to update");
  }
  const wheres = pk.map((item) => {
    params.push(item.value);
    return `${quoteIdent(item.column)} = $${params.length}`;
  });
  const sql = `update ${tableIdent(schema, table)} set ${sets.join(", ")} where ${wheres.join(" and ")}`;
  return withClient(config, database, async (client) => {
    const res = await client.query(sql, params);
    return { rowsAffected: res.rowCount ?? 0 };
  });
}

export async function deleteRow(
  config: PostgresConfig,
  database: string,
  schema: string,
  table: string,
  pk: PrimaryKeyValue[]
): Promise<{ rowsAffected: number }> {
  if (pk.length === 0) {
    throw new Error("Cannot delete: no primary key on this table");
  }
  const params: unknown[] = [];
  const wheres = pk.map((item) => {
    params.push(item.value);
    return `${quoteIdent(item.column)} = $${params.length}`;
  });
  const sql = `delete from ${tableIdent(schema, table)} where ${wheres.join(" and ")}`;
  return withClient(config, database, async (client) => {
    const res = await client.query(sql, params);
    return { rowsAffected: res.rowCount ?? 0 };
  });
}
