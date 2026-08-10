/**
 * Row shapes the MySQL table-detail API returns. Split out of
 * `table-detail-client.tsx` in Task 11 so the client can shrink to a
 * descriptor plus its dialogs.
 */

export interface IndexInfo {
  name: string;
  unique: boolean;
  primary: boolean;
  type: string;
  columns: string[];
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  /** Full COLUMN_TYPE, e.g. `varchar(255)`, `int unsigned`. */
  columnType: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  extra: string;
  comment: string;
  ordinal: number;
}

export type ColumnValue = string | number | boolean | null;

/** The one payload every non-data tab reads — MySQL is a `single` load. */
export interface TableMeta {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  ddl: string;
  primaryKey: string[];
}

export interface RowsPage {
  columns: string[];
  rows: Record<string, ColumnValue>[];
  totalRows: number;
  primaryKey: string[];
}
