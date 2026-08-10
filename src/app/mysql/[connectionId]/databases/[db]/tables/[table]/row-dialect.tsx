import type { RowFormDialect } from "@/components/workspace/sql/row-form-dialog";
import type { SqlColumn } from "@/components/workspace/sql/types";

/**
 * MySQL flavor of the row form dialect — brand tint, plain scalars, `pk` as
 * a keyed object. Ported from the pre-Task-9 `row-form-dialog.tsx` that
 * lived in this directory, including its number/boolean coercion
 * (`toPayload`/`buildValues`) — the brief's own sketch for this dialect's
 * `toBody` sends every value as a raw string and drops that coercion; doing
 * so would submit e.g. `"42"` instead of `42` for every numeric column, and
 * would stop mapping a blank numeric field to `null` (it would submit `""`
 * instead, which MySQL will happily but wrongly coerce to `0` in non-strict
 * SQL mode). This file restores the original behaviour.
 *
 * `SqlColumn.dataType` carries MySQL's full `COLUMN_TYPE` here (e.g.
 * `"tinyint(1)"`, `"decimal(10,2)"`, `"int unsigned"`) — the same
 * convention `table-detail-client.tsx` already uses for `StructurePanel`.
 * The original dialog kept a *second*, bare `dataType` field (`"tinyint"`,
 * `"decimal"`) alongside the full `columnType` and used the bare one for
 * long-text/number detection; `SqlColumn` only has room for one string, so
 * long-text and number-type detection below match by *prefix* against the
 * full type instead of by exact match against the bare one. None of these
 * type keywords ever appears as a prefix of an unrelated MySQL type name
 * (checked against the full COLUMN_TYPE vocabulary), so this is behaviourally
 * identical to the original bare-type check, just re-derived from the one
 * field SqlColumn has.
 */

const NUMBER_PREFIXES = [
  "int",
  "bigint",
  "smallint",
  "mediumint",
  "tinyint",
  "decimal",
  "float",
  "double",
];

function isAutoIncrement(c: SqlColumn): boolean {
  return /auto_increment/i.test(c.extra ?? "");
}

function isNumberType(dataType: string): boolean {
  const t = dataType.toLowerCase();
  return NUMBER_PREFIXES.some((p) => t.startsWith(p));
}

function isBooleanType(dataType: string): boolean {
  return dataType === "tinyint(1)";
}

function isLongTextType(dataType: string): boolean {
  const t = dataType.toLowerCase();
  return (
    t === "text" ||
    t === "mediumtext" ||
    t === "longtext" ||
    t === "tinytext" ||
    t === "blob" ||
    t === "json"
  );
}

/** Convert a tri-state cell into the scalar the mysql `/rows` API expects. */
function toScalar(
  column: SqlColumn,
  state: { kind: "null" } | { kind: "default" } | { kind: "value"; value: string },
): string | number | boolean | null {
  if (state.kind === "null") return null;
  // "default" cells are omitted by the caller — never reaches here.
  if (state.kind === "default") return null;
  const raw = state.value;
  if (isBooleanType(column.dataType)) return raw === "1" || raw === "true" ? 1 : 0;
  if (isNumberType(column.dataType)) {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

export const mysqlRowDialect: RowFormDialect = {
  tint: "brand",
  lockedOnInsert: (c) => c.default !== null || isAutoIncrement(c),
  isBoolean: isBooleanType,
  isLongText: isLongTextType,
  isJsonText: (dt) => dt === "json",
  booleanOptions: [
    { value: "1", label: "true" },
    { value: "0", label: "false" },
  ],
  defaultCellLabel: (c) => (isAutoIncrement(c) ? "auto_increment" : "default"),
  columnBadge: (c) =>
    isAutoIncrement(c) ? (
      <span className="shrink-0 text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground/70">
        auto_increment
      </span>
    ) : null,
  toBody: ({ mode, values, columns, initialRow }) => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const c of columns) {
      const state = values[c.name] ?? { kind: "value" as const, value: "" };
      if (state.kind === "default") continue;
      out[c.name] = toScalar(c, state);
    }
    if (mode === "insert") return { values: out };
    const pk = Object.fromEntries(
      columns
        .filter((c) => c.isPrimaryKey)
        .map((c) => [c.name, initialRow?.[c.name] ?? null]),
    );
    return { values: out, pk };
  },
};
