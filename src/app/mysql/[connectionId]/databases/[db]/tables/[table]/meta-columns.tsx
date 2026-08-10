"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetaTable, type MetaColumn } from "@/components/workspace/sql/meta-table";
import { Plus, Trash2 } from "lucide-react";
import type {
  IndexInfo,
  MysqlConstraintRow,
  MysqlForeignKeyRow,
} from "./table-types";

/**
 * The MySQL metadata panels — Indexes (with its toolbar), Constraints and
 * Foreign keys. Per-tech panel definitions like these are what the L2 shell's
 * descriptor points at; they live beside the client rather than inside it so
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
  onDrop,
}: {
  indexes: IndexInfo[];
  onDrop: (name: string) => void;
}) {
  return (
    <MetaTable
      items={indexes}
      columns={indexColumns(onDrop)}
      rowKey={(i) => i.name}
      empty="No indexes."
    />
  );
}

export function ConstraintsPanel({ constraints }: { constraints: MysqlConstraintRow[] }) {
  return (
    <MetaTable
      items={constraints}
      columns={constraintColumns}
      rowKey={(c) => c.name}
      empty="No constraints."
    />
  );
}

export function ForeignKeysPanel({
  foreignKeys,
}: {
  foreignKeys: MysqlForeignKeyRow[];
}) {
  return (
    <MetaTable
      items={foreignKeys}
      columns={foreignKeyColumns}
      rowKey={(f) => f.name}
      empty="No foreign keys."
    />
  );
}

const constraintColumns: MetaColumn<MysqlConstraintRow>[] = [
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
    // Only CHECK constraints carry a clause; PRIMARY KEY / UNIQUE / FOREIGN
    // KEY rows come back with an empty definition from information_schema.
    cell: (c) => c.definition || "—",
  },
];

const foreignKeyColumns: MetaColumn<MysqlForeignKeyRow>[] = [
  {
    header: "Name",
    className: () => "font-mono text-xs",
    cell: (f) => f.name,
  },
  {
    header: "Columns",
    className: () => "font-mono text-xs",
    cell: (f) => f.columns.join(", "),
  },
  {
    header: "References",
    className: () => "font-mono text-xs",
    cell: (f) => (
      <>
        {f.refSchema}.{f.refTable} ({f.refColumns.join(", ")})
      </>
    ),
  },
  {
    header: "On update",
    className: () => "font-mono text-xs",
    cell: (f) => f.onUpdate,
  },
  {
    header: "On delete",
    className: () => "font-mono text-xs",
    cell: (f) => f.onDelete,
  },
];

function indexColumns(onDrop: (name: string) => void): MetaColumn<IndexInfo>[] {
  return [
    {
      header: "Name",
      className: () => "font-mono text-xs",
      cell: (i) => i.name,
    },
    {
      header: "Kind",
      className: () => "space-x-1",
      cell: (i) => (
        <>
          {i.primary ? <Badge>primary</Badge> : null}
          {i.unique && !i.primary ? <Badge variant="secondary">unique</Badge> : null}
        </>
      ),
    },
    {
      header: "Type",
      className: () => "font-mono text-[11px] text-muted-foreground",
      cell: (i) => i.type,
    },
    {
      header: "Columns",
      className: () => "font-mono text-[11px] text-muted-foreground break-all",
      cell: (i) => i.columns.join(", "),
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
            className="size-7 text-destructive hover:text-destructive"
            disabled={i.primary}
            title={i.primary ? "Primary key index can't be dropped here" : "Drop index"}
            onClick={() => onDrop(i.name)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];
}
