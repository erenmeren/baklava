"use client";

import { Badge } from "@/components/ui/badge";
import { MetaTable, type MetaColumn } from "@/components/workspace/sql/meta-table";
import { cn } from "@/lib/utils";
import {
  fmtBytes,
  type ConstraintRow,
  type ForeignKeyRow,
  type Index,
} from "./table-types";

/**
 * The three SQL Server metadata panels. Per-tech panel definitions like these
 * are what the L2 shell's descriptor points at — they live beside the client
 * rather than inside it so the client stays a descriptor and its dialogs.
 */

export function IndexesPanel({ indexes }: { indexes: Index[] }) {
  return (
    <MetaTable
      items={indexes}
      columns={indexColumns}
      rowKey={(i) => i.name}
      rowClassName={(i) => (i.unused ? "bg-amber-500/5" : undefined)}
      empty="No indexes."
    />
  );
}

export function ConstraintsPanel({ constraints }: { constraints: ConstraintRow[] }) {
  return (
    <MetaTable
      items={constraints}
      columns={constraintColumns}
      rowKey={(c) => c.name}
      empty="No check/default constraints."
    />
  );
}

export function ForeignKeysPanel({ foreignKeys }: { foreignKeys: ForeignKeyRow[] }) {
  return (
    <MetaTable
      items={foreignKeys}
      columns={foreignKeyColumns}
      rowKey={(f) => f.name}
      empty="No foreign keys."
    />
  );
}

const indexColumns: MetaColumn<Index>[] = [
  {
    header: "Name",
    className: () => "font-mono text-xs",
    cell: (i) => (
      <span className="inline-flex items-center gap-1.5">
        {i.name}
        {i.isPrimaryKey ? <Badge>PK</Badge> : null}
        {i.isUnique && !i.isPrimaryKey ? <Badge variant="secondary">unique</Badge> : null}
        {i.unused ? (
          <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] uppercase tracking-wider text-amber-600">
            unused
          </span>
        ) : null}
      </span>
    ),
  },
  {
    header: "Type",
    className: () => "text-[11px] font-mono text-muted-foreground",
    cell: (i) => i.typeDesc,
  },
  {
    header: "Key columns",
    className: () => "font-mono text-[11px]",
    cell: (i) => (
      <>
        {i.keyColumns.join(", ")}
        {i.includedColumns.length > 0 ? (
          <span className="text-muted-foreground/60">
            {" "}
            INCLUDE ({i.includedColumns.join(", ")})
          </span>
        ) : null}
      </>
    ),
  },
  {
    header: "Size",
    align: "right",
    className: () => "font-mono text-[11px] tabular-nums text-muted-foreground",
    cell: (i) => fmtBytes(i.sizeBytes),
  },
  {
    header: "Seeks/Scans",
    align: "right",
    className: (i) =>
      cn(
        "font-mono text-[11px] tabular-nums",
        i.userSeeks + i.userScans === 0 ? "text-amber-600" : "text-muted-foreground",
      ),
    cell: (i) => (i.userSeeks + i.userScans + i.userLookups).toLocaleString(),
  },
];

const constraintColumns: MetaColumn<ConstraintRow>[] = [
  {
    header: "Name",
    className: () => "font-mono text-xs",
    cell: (c) => c.name,
  },
  {
    header: "Type",
    className: () => "text-xs",
    cell: (c) => c.type,
  },
  {
    header: "Definition",
    className: () => "font-mono text-[11px] text-muted-foreground break-all",
    cell: (c) => c.definition,
  },
];

const foreignKeyColumns: MetaColumn<ForeignKeyRow>[] = [
  {
    header: "Name",
    className: () => "font-mono text-xs",
    cell: (f) => f.name,
  },
  {
    header: "Columns",
    className: () => "font-mono text-[11px]",
    cell: (f) => f.columns.join(", "),
  },
  {
    header: "References",
    className: () => "font-mono text-[11px]",
    cell: (f) => (
      <>
        {f.refSchema}.{f.refTable} ({f.refColumns.join(", ")})
      </>
    ),
  },
  {
    header: "On update / delete",
    className: () => "text-[11px] text-muted-foreground",
    cell: (f) => (
      <>
        {f.onUpdate} / {f.onDelete}
      </>
    ),
  },
];
