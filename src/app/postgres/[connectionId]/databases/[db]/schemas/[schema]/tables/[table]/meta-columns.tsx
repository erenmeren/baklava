"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetaTable, type MetaColumn } from "@/components/workspace/sql/meta-table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatBytes,
  type ConstraintInfo,
  type ForeignKeyInfo,
  type IndexInfo,
} from "./table-types";

/**
 * The three Postgres metadata panels and the Structure tab's foreign-key
 * chips. Per-tech panel definitions like these are what the L2 shell's
 * descriptor points at — they live beside the client rather than inside it so
 * the client stays a descriptor and its dialogs.
 */

export function IndexesToolbar({
  indexes,
  canCreate,
  onCreate,
}: {
  indexes: IndexInfo[] | undefined;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[11px] text-muted-foreground font-mono">
        {indexes ? `${indexes.length} index${indexes.length === 1 ? "" : "es"}` : "…"}
      </p>
      <Button size="sm" variant="outline" onClick={onCreate} disabled={!canCreate}>
        <Plus className="size-3.5" />
        New index
      </Button>
    </div>
  );
}

export function IndexesPanel({
  indexes,
  onRename,
  onDrop,
}: {
  indexes: IndexInfo[];
  onRename: (name: string) => void;
  onDrop: (name: string) => void;
}) {
  return (
    <MetaTable
      items={indexes}
      columns={indexColumns({ onRename, onDrop })}
      rowKey={(i) => i.name}
      rowClassName={(i) => (i.unused ? "bg-amber-500/5" : undefined)}
      empty="No indexes."
    />
  );
}

export function ConstraintsPanel({ constraints }: { constraints: ConstraintInfo[] }) {
  return (
    <MetaTable
      items={constraints}
      columns={constraintColumns}
      rowKey={(c) => c.name}
      empty="No constraints."
    />
  );
}

export function ForeignKeysPanel({ foreignKeys }: { foreignKeys: ForeignKeyInfo[] }) {
  return (
    <MetaTable
      items={foreignKeys}
      columns={foreignKeyColumns}
      rowKey={(fk) => fk.name}
      empty="No foreign keys."
    />
  );
}

function indexColumns(handlers: {
  onRename: (name: string) => void;
  onDrop: (name: string) => void;
}): MetaColumn<IndexInfo>[] {
  return [
    {
      header: "Name",
      className: () => "font-mono text-xs",
      cell: (i) => (
        <div className="flex items-center gap-2">
          {i.name}
          {i.unused ? (
            <span
              className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] uppercase tracking-wider text-amber-600"
              title="No scans since last stats reset — candidate for drop."
            >
              unused
            </span>
          ) : null}
        </div>
      ),
    },
    {
      header: "Kind",
      className: () => "space-x-1",
      cell: (i) => (
        <>
          {i.isPrimary ? <Badge>primary</Badge> : null}
          {i.isUnique && !i.isPrimary ? (
            <Badge variant="secondary">unique</Badge>
          ) : null}
        </>
      ),
    },
    {
      header: "Size",
      align: "right",
      className: () => "font-mono text-[11px] tabular-nums text-muted-foreground",
      cell: (i) => formatBytes(i.sizeBytes),
    },
    {
      header: "Scans",
      align: "right",
      className: (i) =>
        cn(
          "font-mono text-[11px] tabular-nums",
          i.scans === 0 ? "text-amber-600" : "text-muted-foreground",
        ),
      cell: (i) => i.scans.toLocaleString(),
    },
    {
      header: "Tuples read",
      align: "right",
      className: () => "font-mono text-[11px] tabular-nums text-muted-foreground",
      cell: (i) => i.tuplesRead.toLocaleString(),
    },
    {
      header: "Definition",
      className: () => "font-mono text-[11px] text-muted-foreground break-all",
      cell: (i) => i.definition,
    },
    {
      header: null,
      headClassName: "w-px",
      className: () => "whitespace-nowrap",
      cell: (i) => (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={i.isPrimary}
            title={
              i.isPrimary ? "Primary key index can't be renamed here" : "Rename index"
            }
            onClick={() => handlers.onRename(i.name)}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-destructive hover:text-destructive"
            disabled={i.isPrimary}
            title={
              i.isPrimary ? "Primary key index can't be dropped here" : "Drop index"
            }
            onClick={() => handlers.onDrop(i.name)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];
}

const constraintColumns: MetaColumn<ConstraintInfo>[] = [
  {
    header: "Name",
    className: () => "font-mono text-xs",
    cell: (c) => c.name,
  },
  {
    header: "Type",
    cell: (c) => (
      <Badge variant="secondary" className="font-mono">
        {c.type}
      </Badge>
    ),
  },
  {
    header: "Definition",
    className: () => "font-mono text-[11px] text-muted-foreground break-all",
    cell: (c) => c.definition,
  },
];

const foreignKeyColumns: MetaColumn<ForeignKeyInfo>[] = [
  {
    header: "Name",
    className: () => "font-mono text-xs",
    cell: (fk) => fk.name,
  },
  {
    header: "Columns",
    className: () => "font-mono text-xs",
    cell: (fk) => fk.columns.join(", "),
  },
  {
    header: "References",
    className: () => "font-mono text-xs",
    cell: (fk) => (
      <>
        {fk.refSchema}.{fk.refTable} ({fk.refColumns.join(", ")})
      </>
    ),
  },
  {
    header: "On update",
    className: () => "font-mono text-xs",
    cell: (fk) => fk.onUpdate,
  },
  {
    header: "On delete",
    className: () => "font-mono text-xs",
    cell: (fk) => fk.onDelete,
  },
];

/** "→ schema.table.column" chips under a column on the Structure tab. */
export function fkChips(
  columnName: string,
  foreignKeys: ForeignKeyInfo[] | undefined,
): React.ReactNode[] {
  if (!foreignKeys) return [];
  const out: React.ReactNode[] = [];
  for (const fk of foreignKeys) {
    const idx = fk.columns.indexOf(columnName);
    if (idx >= 0 && fk.refColumns[idx]) {
      out.push(
        <span
          key={fk.name}
          className={cn(
            "inline-flex items-center px-1.5 py-px rounded border text-[10px] whitespace-nowrap",
            "bg-foreground/5 text-foreground/80 border-border normal-case tracking-normal text-[10.5px]",
          )}
        >
          → {fk.refSchema}.{fk.refTable}.{fk.refColumns[idx]}
        </span>,
      );
    }
  }
  return out;
}
