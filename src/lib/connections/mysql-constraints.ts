import type { RowDataPacket } from "mysql2/promise"; // type-only — erased at build, safe when mysql2 absent
import type { MysqlConfig } from "./types";
import { withConn, query } from "./mysql-internal";
import { validateIdentifier } from "./mysql";

/**
 * Constraint and foreign-key introspection for MySQL. Kept out of the
 * 1161-line `mysql.ts` (Phase 2 scope note: that file is under the split bar
 * and was deliberately not split).
 *
 * Both queries read `information_schema` with the database and table as bound
 * parameters — never interpolated — so no identifier quoting is involved.
 * `validateIdentifier` still runs first, so a hostile name fails the same way
 * it does everywhere else in the driver rather than reaching the server.
 */

export interface MysqlConstraint {
  name: string;
  type: string;
  definition: string;
}

export interface MysqlForeignKey {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}

/** Row shape the KEY_COLUMN_USAGE query returns, before grouping. Exported for tests. */
export interface ForeignKeyRow {
  name: string;
  column_name: string;
  ordinal: number;
  ref_schema: string;
  ref_table: string;
  ref_column: string;
  on_update: string;
  on_delete: string;
}

const CONSTRAINTS_SQL_WITH_CHECKS = `
SELECT tc.CONSTRAINT_NAME AS name,
       tc.CONSTRAINT_TYPE  AS type,
       COALESCE(cc.CHECK_CLAUSE, '') AS definition
FROM information_schema.TABLE_CONSTRAINTS tc
LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
       ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
      AND cc.CONSTRAINT_NAME   = tc.CONSTRAINT_NAME
WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME`;

const CONSTRAINTS_SQL_NO_CHECKS = `
SELECT tc.CONSTRAINT_NAME AS name,
       tc.CONSTRAINT_TYPE  AS type,
       '' AS definition
FROM information_schema.TABLE_CONSTRAINTS tc
WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME`;

const FOREIGN_KEYS_SQL = `
SELECT kcu.CONSTRAINT_NAME AS name,
       kcu.COLUMN_NAME     AS column_name,
       kcu.ORDINAL_POSITION AS ordinal,
       kcu.REFERENCED_TABLE_SCHEMA AS ref_schema,
       kcu.REFERENCED_TABLE_NAME   AS ref_table,
       kcu.REFERENCED_COLUMN_NAME  AS ref_column,
       rc.UPDATE_RULE AS on_update,
       rc.DELETE_RULE AS on_delete
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
     ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
    AND rc.CONSTRAINT_NAME   = kcu.CONSTRAINT_NAME
WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`;

export async function listConstraints(
  config: MysqlConfig,
  database: string,
  table: string,
): Promise<MysqlConstraint[]> {
  validateIdentifier(database, "database name");
  validateIdentifier(table, "table name");
  return withConn(config, database, async (conn) => {
    try {
      const rows = await query<MysqlConstraint & RowDataPacket>(
        conn,
        CONSTRAINTS_SQL_WITH_CHECKS,
        [database, table],
      );
      return rows.map(toConstraint);
    } catch (err) {
      // information_schema.CHECK_CONSTRAINTS only exists on MySQL 8.0.16+.
      // Older servers (and MariaDB before 10.2.22) reject the LEFT JOIN with
      // ER_NO_SUCH_TABLE. Fall back to the constraint list without check
      // clauses rather than showing an empty Constraints tab, which would be
      // an unexplainable support mystery.
      if ((err as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw err;
      const rows = await query<MysqlConstraint & RowDataPacket>(
        conn,
        CONSTRAINTS_SQL_NO_CHECKS,
        [database, table],
      );
      return rows.map(toConstraint);
    }
  });
}

function toConstraint(r: MysqlConstraint): MysqlConstraint {
  return { name: r.name, type: r.type, definition: r.definition ?? "" };
}

export async function listForeignKeys(
  config: MysqlConfig,
  database: string,
  table: string,
): Promise<MysqlForeignKey[]> {
  validateIdentifier(database, "database name");
  validateIdentifier(table, "table name");
  const rows = await withConn(config, database, (conn) =>
    query<ForeignKeyRow & RowDataPacket>(conn, FOREIGN_KEYS_SQL, [database, table]),
  );
  return groupForeignKeyRows(rows);
}

/** Pure: collapse per-column rows into one entry per constraint. Exported for tests. */
export function groupForeignKeyRows(rows: ForeignKeyRow[]): MysqlForeignKey[] {
  const byName = new Map<string, { row: ForeignKeyRow; cols: ForeignKeyRow[] }>();
  for (const r of rows) {
    const entry = byName.get(r.name);
    if (entry) entry.cols.push(r);
    else byName.set(r.name, { row: r, cols: [r] });
  }
  return [...byName.values()].map(({ row, cols }) => {
    // Sort here rather than trusting the ORDER BY: a composite key's column
    // order is part of the constraint's meaning, and this function is also
    // the unit under test, where rows arrive deliberately unsorted.
    const ordered = [...cols].sort((a, b) => a.ordinal - b.ordinal);
    return {
      name: row.name,
      columns: ordered.map((c) => c.column_name),
      refSchema: row.ref_schema,
      refTable: row.ref_table,
      refColumns: ordered.map((c) => c.ref_column),
      onUpdate: row.on_update,
      onDelete: row.on_delete,
    };
  });
}
