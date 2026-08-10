import type { RowFormDialect } from "@/components/workspace/sql/row-form-dialog";

/**
 * Postgres flavor of the row form dialect — brand tint, tagged-union values,
 * `pk` as a `{column, value}[]`. Ported verbatim from the pre-Task-9
 * `row-form-dialog.tsx` that lived in this directory.
 */
export const postgresRowDialect: RowFormDialect = {
  tint: "brand",
  lockedOnInsert: (c) => c.default !== null,
  // Postgres reports both spellings depending on catalog path; the original
  // dialog accepted either.
  isBoolean: (dt) => dt === "bool" || dt === "boolean",
  isLongText: (dt) => dt === "text" || dt === "json" || dt === "jsonb",
  isJsonText: (dt) => dt === "json" || dt === "jsonb",
  toBody: ({ mode, values, columns, initialRow }) => {
    if (mode === "insert") return { values };
    const pk = columns
      .filter((c) => c.isPrimaryKey)
      .map((c) => ({ column: c.name, value: initialRow?.[c.name] ?? null }));
    return { pk, values };
  },
};
