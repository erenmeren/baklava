import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";
import type { RowFormDialect } from "@/components/workspace/sql/row-form-dialog";
import type { SqlColumn } from "@/components/workspace/sql/types";

/**
 * SQL Server flavor of the row form dialect — rose tint, tagged-union
 * values, `pk` as a `{column, value}[]`, IDENTITY columns locked out of the
 * insert form entirely (not just defaulted). Ported from the pre-Task-9
 * `row-form-dialog.tsx` that lived in this directory.
 *
 * `SqlColumn` has no `isIdentity` field, so the call site's
 * `table-detail-client.tsx` marks an identity column by setting
 * `extra: "identity"` on the `SqlColumn[]` it builds specifically for this
 * dialog (a separate mapping from the one it builds for `StructurePanel`,
 * whose `extra` carries `"IDENTITY(seed,increment)"` / `"computed"` for a
 * different purpose — the two never mix since they're different arrays).
 */
function isIdentity(c: SqlColumn): boolean {
  return c.extra === "identity";
}

export const sqlserverRowDialect: RowFormDialect = {
  tint: "rose",
  lockedOnInsert: (c) => isIdentity(c) || c.default !== null,
  // IDENTITY can't be overridden on insert at all (unlike a plain server
  // default, which still allows switching to null/a value).
  hardLockedOnInsert: isIdentity,
  isBoolean: (dt) => dt.toLowerCase() === "bit",
  isLongText: (dt) => {
    const t = dt.toLowerCase();
    return /^(n?text)$/.test(t) || /^x?ml$/.test(t) || t.includes("(max)");
  },
  booleanOptions: [
    { value: "1", label: "1 · true" },
    { value: "0", label: "0 · false" },
  ],
  defaultCellLabel: (c) => (isIdentity(c) ? "identity" : "default"),
  columnBadge: (c) =>
    isIdentity(c) ? (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 text-[9px] font-mono uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400 py-0"
      >
        <Zap className="size-2.5" /> IDENTITY
      </Badge>
    ) : null,
  toBody: ({ mode, values, columns, initialRow }) => {
    if (mode === "insert") return { values };
    const pk = columns
      .filter((c) => c.isPrimaryKey)
      .map((c) => ({ column: c.name, value: initialRow?.[c.name] ?? null }));
    return { pk, values };
  },
};
