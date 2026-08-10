/**
 * Row shapes the SQL Server table-detail API returns, the byte formatter its
 * panels share, and the client-side DDL builder. Split out of
 * `table-detail-client.tsx` in Task 11 so the client can shrink to a
 * descriptor plus its dialogs.
 */

export interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  identitySeed: string | null;
  identityIncrement: string | null;
  isComputed: boolean;
  computedDefinition: string | null;
  isPrimaryKey: boolean;
  defaultDefinition: string | null;
  maxLength: number | null;
}

export interface Index {
  name: string;
  typeDesc: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
  keyColumns: string[];
  includedColumns: string[];
  sizeBytes: number;
  userSeeks: number;
  userScans: number;
  userLookups: number;
  userUpdates: number;
  unused: boolean;
}

export interface ConstraintRow {
  name: string;
  type: string;
  definition: string;
}

export interface ForeignKeyRow {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}

/** The one payload every non-data tab reads — SQL Server is a `single` load. */
export interface Detail {
  schema: string;
  table: string;
  isHeap: boolean;
  rowCount: number;
  columns: Column[];
  indexes: Index[];
  constraints: ConstraintRow[];
  foreignKeys: ForeignKeyRow[];
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Mirror of buildSqlServerTableDDL on the client so we don't round-trip for DDL.
export function buildClientDdl(d: Detail): string {
  const colLines = d.columns.map((c) => {
    const parts = [`  [${c.name}]`];
    if (c.isComputed && c.computedDefinition) {
      parts.push(`AS ${c.computedDefinition}`);
    } else {
      parts.push(c.dataType);
      if (c.isIdentity) parts.push(`IDENTITY(${c.identitySeed ?? 1},${c.identityIncrement ?? 1})`);
      parts.push(c.nullable ? "NULL" : "NOT NULL");
      if (c.defaultDefinition) parts.push(`DEFAULT ${c.defaultDefinition}`);
    }
    return parts.join(" ");
  });
  const pk = d.columns.filter((c) => c.isPrimaryKey).map((c) => `[${c.name}]`);
  const lines = [...colLines];
  if (pk.length) lines.push(`  PRIMARY KEY (${pk.join(", ")})`);
  const create = `CREATE TABLE [${d.schema}].[${d.table}] (\n${lines.join(",\n")}\n);`;
  const idx = d.indexes
    .filter((i) => !i.isPrimaryKey && i.name !== "(heap)" && i.keyColumns.length > 0)
    .map((i) => {
      const unique = i.isUnique ? "UNIQUE " : "";
      const clustered =
        i.typeDesc.includes("CLUSTERED") && !i.typeDesc.includes("NONCLUSTERED")
          ? "CLUSTERED "
          : "NONCLUSTERED ";
      const incl = i.includedColumns.length
        ? ` INCLUDE (${i.includedColumns.map((c) => `[${c}]`).join(", ")})`
        : "";
      return `CREATE ${unique}${clustered}INDEX [${i.name}] ON [${d.schema}].[${d.table}] (${i.keyColumns
        .map((c) => `[${c}]`)
        .join(", ")})${incl};`;
    });
  const fk = d.foreignKeys.map(
    (f) =>
      `ALTER TABLE [${d.schema}].[${d.table}] ADD CONSTRAINT [${f.name}] FOREIGN KEY (${f.columns
        .map((c) => `[${c}]`)
        .join(", ")}) REFERENCES [${f.refSchema}].[${f.refTable}] (${f.refColumns
        .map((c) => `[${c}]`)
        .join(", ")});`,
  );
  return [create, ...idx, ...fk].join("\n\n");
}
