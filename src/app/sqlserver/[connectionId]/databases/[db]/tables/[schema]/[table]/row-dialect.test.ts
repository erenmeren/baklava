import { describe, it, expect } from "vitest";
import { sqlserverRowDialect as dialect } from "./row-dialect";
import type { SqlColumn } from "@/components/workspace/sql/types";
import type { CellState } from "@/components/workspace/sql/row-form-dialog";

const ID_COL: SqlColumn = {
  name: "id",
  position: 1,
  dataType: "int",
  nullable: false,
  default: null,
  isPrimaryKey: true,
  extra: "identity",
};
const EMAIL_COL: SqlColumn = {
  name: "email",
  position: 2,
  dataType: "nvarchar(255)",
  nullable: false,
  default: null,
  isPrimaryKey: false,
};
const DEFAULTED_COL: SqlColumn = {
  name: "created_at",
  position: 3,
  dataType: "datetime2",
  nullable: false,
  default: "sysutcdatetime()",
  isPrimaryKey: false,
};

describe("sqlserverRowDialect.toBody", () => {
  it("sends {values} verbatim on insert — the tagged union, untouched", () => {
    const values: Record<string, CellState> = {
      id: { kind: "default" },
      email: { kind: "value", value: "a@example.com" },
    };
    // Matches the sqlserver /rows POST route's InsertBody:
    // `values: Record<string, SqlServerColumnValue>`.
    expect(dialect.toBody({ mode: "insert", values, columns: [ID_COL, EMAIL_COL], initialRow: undefined })).toEqual({
      values: {
        id: { kind: "default" },
        email: { kind: "value", value: "a@example.com" },
      },
    });
  });

  it("sends {pk, values} on edit with pk as a {column,value}[] from the original row snapshot", () => {
    const values: Record<string, CellState> = {
      id: { kind: "value", value: "7" },
      email: { kind: "value", value: "new@example.com" },
    };
    const initialRow = { id: 7, email: "old@example.com" };
    expect(dialect.toBody({ mode: "edit", values, columns: [ID_COL, EMAIL_COL], initialRow })).toEqual({
      pk: [{ column: "id", value: 7 }],
      values: {
        id: { kind: "value", value: "7" },
        email: { kind: "value", value: "new@example.com" },
      },
    });
  });

  it("hard-locks only IDENTITY columns, not columns with a plain server default", () => {
    // Targeted-revert check: this is the distinction that makes SQL Server's
    // lock stronger than Postgres/MySQL's — deleting hardLockedOnInsert (or
    // aliasing it to lockedOnInsert) would also hard-lock created_at, which
    // the original dialog never did (its "value"/"null" pills stayed
    // enabled for any non-identity default column).
    expect(dialect.hardLockedOnInsert?.(ID_COL)).toBe(true);
    expect(dialect.hardLockedOnInsert?.(DEFAULTED_COL)).toBe(false);
    // Both are still soft-locked (start in "default" state on insert).
    expect(dialect.lockedOnInsert(ID_COL)).toBe(true);
    expect(dialect.lockedOnInsert(DEFAULTED_COL)).toBe(true);
  });

  it("labels the default cell 'identity' for IDENTITY, plain 'default' otherwise", () => {
    expect(dialect.defaultCellLabel?.(ID_COL)).toBe("identity");
    expect(dialect.defaultCellLabel?.(DEFAULTED_COL)).toBe("default");
  });

  it("treats bit — and only bit — as boolean", () => {
    expect(dialect.isBoolean("bit")).toBe(true);
    expect(dialect.isBoolean("BIT")).toBe(true);
    expect(dialect.isBoolean("int")).toBe(false);
  });

  it("treats ntext/text/xml/(max) types as long text", () => {
    expect(dialect.isLongText("ntext")).toBe(true);
    expect(dialect.isLongText("text")).toBe(true);
    expect(dialect.isLongText("xml")).toBe(true);
    expect(dialect.isLongText("nvarchar(max)")).toBe(true);
    expect(dialect.isLongText("nvarchar(255)")).toBe(false);
  });
});
