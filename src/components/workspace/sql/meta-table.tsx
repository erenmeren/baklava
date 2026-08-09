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
            <TableRow key={rowKey(item)} className={cn("group", rowClassName?.(item))}>
              {columns.map((c, i) => (
                <TableCell key={i} className={cn(c.align === "right" && "text-right")}>
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
