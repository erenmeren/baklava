export interface SqlColumn {
  name: string;
  position: number;
  /** Display type as the server reports it: "integer", "varchar(255)", "nvarchar(max)". */
  dataType: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isUnique?: boolean;
  comment?: string | null;
  /** MySQL's `extra` / SQL Server's IDENTITY(…) / computed marker. Null hides the column. */
  extra?: string | null;
}
