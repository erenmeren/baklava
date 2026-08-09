import { describe, it, expect } from "vitest";
import { mysqlRowDialect as dialect } from "./row-dialect";
import type { SqlColumn } from "@/components/workspace/sql/types";
import type { CellState } from "@/components/workspace/sql/row-form-dialog";

const INT_COL: SqlColumn = {
  name: "age",
  position: 1,
  dataType: "int",
  nullable: true,
  default: null,
  isPrimaryKey: false,
};
const UNSIGNED_INT_COL: SqlColumn = {
  ...INT_COL,
  name: "count",
  dataType: "int unsigned",
};
const DECIMAL_COL: SqlColumn = {
  ...INT_COL,
  name: "price",
  dataType: "decimal(10,2)",
};
const ID_COL: SqlColumn = {
  name: "id",
  position: 0,
  dataType: "int",
  nullable: false,
  default: null,
  isPrimaryKey: true,
  extra: "auto_increment",
};
const NAME_COL: SqlColumn = {
  name: "name",
  position: 2,
  dataType: "varchar(255)",
  nullable: false,
  default: null,
  isPrimaryKey: false,
};
const ACTIVE_COL: SqlColumn = {
  name: "active",
  position: 3,
  dataType: "tinyint(1)",
  nullable: false,
  default: null,
  isPrimaryKey: false,
};

describe("mysqlRowDialect.toBody", () => {
  it("sends a JSON number, not a string, for a typed numeric field", () => {
    // Targeted-revert check: deleting the isNumberType branch in
    // row-dialect.tsx's toScalar (falling through to `return raw`) makes
    // this fail by sending "42" instead of 42.
    const values: Record<string, CellState> = {
      age: { kind: "value", value: "42" },
    };
    const body = dialect.toBody({
      mode: "insert",
      values,
      columns: [INT_COL],
      initialRow: undefined,
    }) as { values: Record<string, unknown> };
    expect(body.values.age).toBe(42);
    expect(typeof body.values.age).toBe("number");
  });

  it("recognizes numeric types carrying a modifier suffix (unsigned, precision)", () => {
    const values: Record<string, CellState> = {
      count: { kind: "value", value: "7" },
      price: { kind: "value", value: "19.99" },
    };
    const body = dialect.toBody({
      mode: "insert",
      values,
      columns: [UNSIGNED_INT_COL, DECIMAL_COL],
      initialRow: undefined,
    }) as { values: Record<string, unknown> };
    expect(body.values.count).toBe(7);
    expect(body.values.price).toBe(19.99);
  });

  it("nulls a blank numeric field instead of sending an empty string", () => {
    const values: Record<string, CellState> = {
      age: { kind: "value", value: "  " },
    };
    const body = dialect.toBody({
      mode: "insert",
      values,
      columns: [INT_COL],
      initialRow: undefined,
    }) as { values: Record<string, unknown> };
    expect(body.values.age).toBeNull();
  });

  it("coerces a boolean toggle's '1'/'0' string into a JSON number for tinyint(1)", () => {
    const values: Record<string, CellState> = {
      active: { kind: "value", value: "1" },
    };
    const body = dialect.toBody({
      mode: "insert",
      values,
      columns: [ACTIVE_COL],
      initialRow: undefined,
    }) as { values: Record<string, unknown> };
    expect(body.values.active).toBe(1);
  });

  it("omits a column left in the default state — the server applies its own default", () => {
    const values: Record<string, CellState> = {
      id: { kind: "default" },
      name: { kind: "value", value: "Ada" },
    };
    // Matches the mysql /rows POST route's InsertBody: `values: Record<string, ColumnValue>`
    // (ColumnValue = string | number | boolean | null) — no `id` key present at all.
    const body = dialect.toBody({
      mode: "insert",
      values,
      columns: [ID_COL, NAME_COL],
      initialRow: undefined,
    }) as { values: Record<string, unknown> };
    expect("id" in body.values).toBe(false);
    expect(body.values).toEqual({ name: "Ada" });
  });

  it("sends pk as a keyed object (not an array) on edit, from the original row snapshot", () => {
    const values: Record<string, CellState> = {
      id: { kind: "value", value: "3" },
      name: { kind: "value", value: "Grace" },
    };
    const initialRow = { id: 3, name: "Ada" };
    // Matches the mysql /rows PATCH route's UpdateBody: `pk: Record<string, ColumnValue>`.
    const body = dialect.toBody({
      mode: "edit",
      values,
      columns: [ID_COL, NAME_COL],
      initialRow,
    }) as { pk: Record<string, unknown>; values: Record<string, unknown> };
    expect(body.pk).toEqual({ id: 3 });
    expect(Array.isArray(body.pk)).toBe(false);
    expect(body.values).toEqual({ id: 3, name: "Grace" });
  });

  it("locks a column with a server default or auto_increment, not a plain nullable column", () => {
    expect(dialect.lockedOnInsert(ID_COL)).toBe(true);
    expect(dialect.lockedOnInsert(NAME_COL)).toBe(false);
  });

  it("only tinyint(1) — not other tinyint widths — is boolean", () => {
    expect(dialect.isBoolean("tinyint(1)")).toBe(true);
    expect(dialect.isBoolean("tinyint(2)")).toBe(false);
    expect(dialect.isBoolean("tinyint")).toBe(false);
  });

  it("labels the default cell auto_increment for an auto_increment column, plain default otherwise", () => {
    expect(dialect.defaultCellLabel?.(ID_COL)).toBe("auto_increment");
    const withDefault: SqlColumn = { ...NAME_COL, default: "''" };
    expect(dialect.defaultCellLabel?.(withDefault)).toBe("default");
  });
});
