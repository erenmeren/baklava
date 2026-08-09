import { describe, it, expect } from "vitest";
import { postgresRowDialect as dialect } from "./row-dialect";
import type { SqlColumn } from "@/components/workspace/sql/types";
import type { CellState } from "@/components/workspace/sql/row-form-dialog";

const COLUMNS: SqlColumn[] = [
  { name: "id", position: 1, dataType: "integer", nullable: false, default: "nextval(…)", isPrimaryKey: true },
  { name: "email", position: 2, dataType: "text", nullable: false, default: null, isPrimaryKey: false },
];

describe("postgresRowDialect.toBody", () => {
  it("sends {values} verbatim on insert — no filtering, default cells included as-is", () => {
    const values: Record<string, CellState> = {
      id: { kind: "default" },
      email: { kind: "value", value: "a@example.com" },
    };
    // This is the exact request body the /rows POST route
    // (src/app/api/postgres/[id]/.../rows/route.ts) deserializes into
    // `InsertBody.values: Record<string, ColumnValue>` — same tagged union,
    // untouched.
    expect(dialect.toBody({ mode: "insert", values, columns: COLUMNS, initialRow: undefined })).toEqual({
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
    // Matches UpdateBody in the same route: `pk: PrimaryKeyValue[]`.
    expect(dialect.toBody({ mode: "edit", values, columns: COLUMNS, initialRow })).toEqual({
      pk: [{ column: "id", value: 7 }],
      values: {
        id: { kind: "value", value: "7" },
        email: { kind: "value", value: "new@example.com" },
      },
    });
  });

  it("pk carries the pre-edit value even when the pk column's own field was changed in the form", () => {
    // Targeted-revert check for the exact bug this guards: if toBody read
    // the pk from `values` instead of `initialRow`, changing the id field
    // in the form would change which row the PATCH's WHERE clause targets.
    const values: Record<string, CellState> = { id: { kind: "value", value: "999" } };
    const initialRow = { id: 7 };
    const body = dialect.toBody({
      mode: "edit",
      values,
      columns: [COLUMNS[0]],
      initialRow,
    }) as { pk: Array<{ column: string; value: unknown }> };
    expect(body.pk).toEqual([{ column: "id", value: 7 }]);
  });

  describe("lockedOnInsert / isBoolean / isLongText", () => {
    it("locks a column with a server default, not one without", () => {
      expect(dialect.lockedOnInsert(COLUMNS[0])).toBe(true);
      expect(dialect.lockedOnInsert(COLUMNS[1])).toBe(false);
    });

    it("accepts both bool and boolean spellings", () => {
      expect(dialect.isBoolean("boolean")).toBe(true);
      expect(dialect.isBoolean("bool")).toBe(true);
      expect(dialect.isBoolean("integer")).toBe(false);
    });

    it("treats text/json/jsonb as long text, nothing else", () => {
      expect(dialect.isLongText("text")).toBe(true);
      expect(dialect.isLongText("json")).toBe(true);
      expect(dialect.isLongText("jsonb")).toBe(true);
      expect(dialect.isLongText("varchar")).toBe(false);
    });
  });
});
