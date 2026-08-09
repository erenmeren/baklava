"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Metadata list — indexes, constraints, foreign keys. Six copies of this
 * markup existed across the three SQL table-detail clients; only the column
 * set ever differed, so that is the only thing callers supply.
 */
export interface MetaColumn<T> {
  header: React.ReactNode;
  align?: "left" | "right";
  headClassName?: string;
  /**
   * Applied to the rendered <TableCell> (the <td> itself) — font size,
   * color, truncation, tabular-nums, etc. Per-item because some columns
   * (e.g. "0 scans" turning amber) depend on the row's data, not just its
   * column. Callers with a static class still return one, e.g. `() =>
   * "font-mono text-xs"`.
   */
  className?: (item: T) => string | undefined;
  cell: (item: T) => React.ReactNode;
}

export function MetaTable<T>({
  items,
  columns,
  rowKey,
  rowClassName,
  empty,
}: {
  items: T[];
  columns: MetaColumn<T>[];
  rowKey: (item: T) => string;
  rowClassName?: (item: T) => string | undefined;
  empty: React.ReactNode;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead
                key={i}
                className={cn(c.align === "right" && "text-right", c.headClassName)}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            // "group" is unconditional even though most callers have no
            // group-hover: descendant — only the indexes panels' per-row
            // rename/drop buttons (opacity-0 group-hover:opacity-100) need
            // it, and there is no cheap per-column signal here for "this
            // table has hover-reveal actions" that wouldn't be its own
            // fragile guess. Harmless everywhere else: it's inert without a
            // group-hover: descendant to key off it.
            <TableRow key={rowKey(item)} className={cn("group", rowClassName?.(item))}>
              {columns.map((c, i) => (
                <TableCell
                  key={i}
                  className={cn(c.align === "right" && "text-right", c.className?.(item))}
                >
                  {c.cell(item)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
