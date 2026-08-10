"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/workspace/confirm-dialog";
import { StructurePanel } from "@/components/workspace/sql/structure-panel";
import { DdlPanel } from "@/components/workspace/sql/ddl-panel";
import type { SqlColumn } from "@/components/workspace/sql/types";
import { SqlTableDetail } from "@/components/workspace/sql/sql-table-detail";
import type {
  SqlTableDetailDescriptor,
  TableDetailControl,
} from "@/components/workspace/sql/descriptor";
import { Trash, Download, Eraser, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { RowFormDialog } from "@/components/workspace/sql/row-form-dialog";
import { mysqlRowDialect } from "./row-dialect";
import { CreateIndexDialog } from "./create-index-dialog";
import { IndexesPanel, IndexesToolbar } from "./meta-columns";
import { TableActionDialog, type TableAction } from "./table-actions";
import { rowsToCSV, rowsToJSON, downloadText } from "@/lib/sql/result-export";
import type { ColumnInfo, ColumnValue, RowsPage, TableMeta } from "./table-types";

interface Props {
  connectionId: string;
  db: string;
  table: string;
}

interface Ctx {
  base: string;
}

async function getJson(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: "no-store", signal });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error as string) || `Request failed (${res.status})`);
  return data;
}

function toSqlColumns(columns: ColumnInfo[]): SqlColumn[] {
  return columns.map((c) => ({
    name: c.name,
    position: c.ordinal,
    dataType: c.columnType,
    nullable: c.nullable,
    default: c.default,
    isPrimaryKey: c.isPrimaryKey,
    comment: c.comment || null,
    extra: c.extra || null,
  }));
}

export function TableDetailClient({ connectionId, db, table }: Props) {
  const base = `/api/mysql/${connectionId}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`;
  const ctx = useMemo<Ctx>(() => ({ base }), [base]);

  const [insertOpen, setInsertOpen] = useState(false);
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [deleteRow, setDeleteRow] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [createIndexOpen, setCreateIndexOpen] = useState(false);
  const [action, setAction] = useState<TableAction>(null);

  const router = useRouter();

  const exportRows = (format: "csv" | "json", fields: string[], tuples: unknown[][]) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "csv") {
      downloadText(`${table}-${stamp}.csv`, rowsToCSV(fields, tuples), "text/csv");
    } else {
      downloadText(`${table}-${stamp}.json`, rowsToJSON(fields, tuples), "application/json");
    }
  };

  const descriptor = useMemo<SqlTableDetailDescriptor<Ctx>>(
    () => ({
      tech: "mysql",
      tabs: ["data", "structure", "indexes", "ddl"],
      capabilities: { insertRow: true, editRow: true, deleteRow: true },
      rowsMutable: (all) => ((all.structure as TableMeta | undefined)?.primaryKey.length ?? 0) > 0,
      readOnlyReason: "no primary key — read only",
      paths: { base: (c) => c.base, rows: (c) => `${c.base}/rows` },
      load: { strategy: "single", fetchAll: (c, signal) => getJson(c.base, signal) },
      data: {
        schemaTab: "structure",
        toolbar: true,
        sortable: true,
        async fetch(c, { offset, limit, sort }, signal) {
          const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
          if (sort) {
            params.set("orderBy", sort.column);
            params.set("orderDir", sort.dir);
          }
          const d = (await getJson(
            `${c.base}/rows?${params.toString()}`,
            signal,
          )) as unknown as RowsPage;
          return {
            fields: d.columns.map((name) => ({ name })),
            // MySQL returns objects keyed by column name; the grid wants
            // tuples aligned with `fields`.
            rows: d.rows.map((r) => d.columns.map((name) => r[name] ?? null)),
            total: d.totalRows,
          };
        },
        columns(page, all) {
          const cols = (all.structure as TableMeta | undefined)?.columns;
          return page.fields.map((f) => {
            const col = cols?.find((c) => c.name === f.name);
            return {
              name: f.name,
              hint: `${col?.columnType ?? ""}${col && !col.nullable ? " · NOT NULL" : ""}`,
              isPrimaryKey: !!col?.isPrimaryKey,
            };
          });
        },
        actions: ({ page, filtered }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" variant="outline">
                  <Download className="size-3.5" />
                  Export
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  exportRows("csv", page.fields.map((f) => f.name), filtered)
                }
              >
                Export page as CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  exportRows("json", page.fields.map((f) => f.name), filtered)
                }
              >
                Export page as JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
      skeleton: { ddl: <Skeleton className="h-40 w-full" /> },
      toolbar: {
        indexes: ({ all }) => (
          <IndexesToolbar
            indexes={(all.structure as TableMeta | undefined)?.indexes}
            canCreate={all.structure !== undefined}
            onCreate={() => setCreateIndexOpen(true)}
          />
        ),
      },
      render: {
        structure: ({ data }) => (
          <StructurePanel columns={toSqlColumns((data as TableMeta).columns)} />
        ),
        indexes: ({ data }) => (
          <IndexesPanel
            indexes={(data as TableMeta).indexes}
            onDrop={(name) => setAction({ kind: "drop-index", name })}
          />
        ),
        ddl: ({ data }) => (
          <DdlPanel label="SHOW CREATE TABLE" ddl={(data as TableMeta).ddl} />
        ),
      },
    }),
    // exportRows only closes over `table`, which is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function performDelete(ctl: TableDetailControl) {
    const primaryKey = (ctl.all.structure as TableMeta | undefined)?.primaryKey ?? [];
    if (!deleteRow || primaryKey.length === 0) return;
    const pk = Object.fromEntries(
      primaryKey.map((c) => [c, (deleteRow[c] as ColumnValue) ?? null]),
    );
    setDeleting(true);
    try {
      const res = await fetch(`${base}/rows`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pk }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Delete failed", { description: data.error });
        return;
      }
      toast.success("Row deleted");
      setDeleteRow(null);
      ctl.reloadData();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SqlTableDetail
      descriptor={descriptor}
      ctx={ctx}
      title={<span className="font-mono">{table}</span>}
      description={
        <span className="text-xs">
          database <span className="font-mono">{db}</span>
        </span>
      }
      actions={(ctl) => (
        <>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <a href={`/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query`} />
            }
            title="Open a SQL query editor for this database"
          >
            <SquareTerminal className="size-3.5" />
            Open query
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAction({ kind: "truncate" })}
            disabled={ctl.all.structure === undefined}
            title="Delete all rows (TRUNCATE)"
          >
            <Eraser className="size-3.5" />
            Truncate
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAction({ kind: "drop-table" })}
            className="text-destructive hover:text-destructive"
            title="Drop this table"
          >
            <Trash className="size-3.5" />
            Drop
          </Button>
        </>
      )}
      onInsertRow={() => setInsertOpen(true)}
      onEditRow={setEditRow}
      onDeleteRow={setDeleteRow}
    >
      {(ctl) => {
        const meta = ctl.all.structure as TableMeta | undefined;
        const label = (
          <span className="font-mono text-foreground/80">
            {db}.{table}
          </span>
        );
        return (
          <>
            {meta ? (
              <>
                <RowFormDialog
                  open={insertOpen}
                  onOpenChange={setInsertOpen}
                  mode="insert"
                  base={base}
                  title="Insert row"
                  description={label}
                  columns={toSqlColumns(meta.columns)}
                  dialect={mysqlRowDialect}
                  onSuccess={() => ctl.reloadData()}
                />
                <RowFormDialog
                  open={editRow !== null}
                  onOpenChange={(v) => {
                    if (!v) setEditRow(null);
                  }}
                  mode="edit"
                  base={base}
                  title="Edit row"
                  description={label}
                  columns={toSqlColumns(meta.columns)}
                  initialRow={editRow ?? undefined}
                  dialect={mysqlRowDialect}
                  onSuccess={() => ctl.reloadData()}
                />
              </>
            ) : null}

            <CreateIndexDialog
              open={createIndexOpen}
              onOpenChange={setCreateIndexOpen}
              connectionId={connectionId}
              db={db}
              table={table}
              availableColumns={meta?.columns.map((c) => c.name) ?? []}
              onCreated={() => {
                ctl.refresh("structure");
                if (ctl.tab !== "indexes") ctl.setTab("indexes");
              }}
            />

            <TableActionDialog
              base={base}
              table={table}
              action={action}
              onClose={() => setAction(null)}
              onDone={(kind) => {
                if (kind === "drop-index") ctl.refresh("structure");
                else if (kind === "truncate") ctl.reloadData(0);
                else
                  router.push(
                    `/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query`,
                  );
              }}
            />

            <ConfirmDialog
              open={deleteRow !== null}
              onOpenChange={() => setDeleteRow(null)}
              title="Delete row?"
              description={
                <>
                  This will run <span className="font-mono">DELETE FROM {table}</span> for
                  the selected row. This cannot be undone.
                </>
              }
              confirmLabel="Delete"
              working={deleting}
              onConfirm={() => void performDelete(ctl)}
            />
          </>
        );
      }}
    </SqlTableDetail>
  );
}
