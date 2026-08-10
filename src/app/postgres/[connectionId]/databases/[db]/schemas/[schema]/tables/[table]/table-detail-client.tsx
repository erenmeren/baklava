"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StructurePanel } from "@/components/workspace/sql/structure-panel";
import { DdlPanel } from "@/components/workspace/sql/ddl-panel";
import { ConfirmDialog } from "@/components/workspace/confirm-dialog";
import type { SqlColumn } from "@/components/workspace/sql/types";
import { SqlTableDetail } from "@/components/workspace/sql/sql-table-detail";
import type {
  SqlTableDetailDescriptor,
  TableDetailControl,
} from "@/components/workspace/sql/descriptor";
import { Wand2, Trash } from "lucide-react";
import { toast } from "sonner";
import { RowFormDialog } from "@/components/workspace/sql/row-form-dialog";
import { postgresRowDialect } from "./row-dialect";
import { DropConfirm, type DropTarget } from "../../../../../../drop-confirm";
import { ModifyTableDialog, type ColumnInfo } from "../../../../../../modify-table-dialog";
import { CreateIndexDialog } from "./create-index-dialog";
import { StatsGrid } from "./stats-grid";
import {
  ConstraintsPanel,
  ForeignKeysPanel,
  IndexesPanel,
  IndexesToolbar,
  fkChips,
} from "./meta-columns";
import { IndexActionDialogs } from "./index-dialogs";
import type {
  ConstraintInfo,
  ForeignKeyInfo,
  IndexInfo,
  TableData,
  TableStats,
} from "./table-types";

interface Props {
  connectionId: string;
  db: string;
  schema: string;
  table: string;
}

/** What every descriptor callback needs to build a URL. */
interface Ctx {
  base: string;
  schema: string;
  table: string;
}

async function getJson(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: "no-store", signal });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error as string) || `Request failed (${res.status})`);
  return data;
}

/** One `?view=<name>` source, unwrapped to the field the panels actually read. */
function view(name: string, field: string) {
  return async (c: Ctx, signal: AbortSignal) =>
    (await getJson(`${c.base}?view=${name}`, signal))[field];
}

function toSqlColumns(columns: ColumnInfo[]): SqlColumn[] {
  return columns.map((c) => ({
    name: c.name,
    position: c.position,
    dataType: c.dataType,
    nullable: c.isNullable,
    default: c.default,
    isPrimaryKey: c.isPrimaryKey,
    isUnique: c.isUnique,
    comment: c.comment,
  }));
}

export function TableDetailClient({ connectionId, db, schema, table }: Props) {
  const base = `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}`;
  const ctx = useMemo<Ctx>(() => ({ base, schema, table }), [base, schema, table]);

  const [insertOpen, setInsertOpen] = useState(false);
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [deleteRow, setDeleteRow] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [createIndexOpen, setCreateIndexOpen] = useState(false);
  const [renameIdx, setRenameIdx] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<string | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Sidebar "Modify…" navigates here with ?modify=1 — open the dialog on
  // arrival and strip the query string so a refresh doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("modify") === "1") {
      setModifyOpen(true);
      router.replace(pathname);
    }
  }, [searchParams, router, pathname]);

  const dropTarget: DropTarget = { kind: "table", database: db, schema, name: table };

  const descriptor = useMemo<SqlTableDetailDescriptor<Ctx>>(
    () => ({
      tech: "postgres",
      tabs: ["data", "structure", "indexes", "constraints", "foreign_keys", "ddl", "stats"],
      capabilities: { insertRow: true, editRow: true, deleteRow: true },
      rowsMutable: (all) =>
        ((all.structure as ColumnInfo[] | undefined) ?? []).some((c) => c.isPrimaryKey),
      readOnlyReason: "This table has no primary key",
      paths: { base: (c) => c.base, rows: (c) => `${c.base}/rows` },
      load: {
        // Every catalog view is its own `?view=` round-trip, so every tab is
        // its own source (the default `tabSource`) and stays unfetched until
        // that tab opens.
        sources: {
          structure: view("structure", "columns"),
          indexes: view("indexes", "indexes"),
          constraints: view("constraints", "constraints"),
          foreign_keys: view("foreign_keys", "foreignKeys"),
          ddl: view("ddl", "ddl"),
          stats: view("stats", "stats"),
        },
        // Columns drive the Data tab's header hints, the PK markers and both
        // mutation buttons, so they load whichever tab is open.
        eager: ["structure"],
        // The Structure tab's FK chips come from a second view.
        prefetch: { structure: ["foreign_keys"] },
      },
      data: {
        schemaTab: "structure",
        toolbar: true,
        async fetch(c, { offset, limit }, signal) {
          const d = (await getJson(
            `${c.base}?view=data&limit=${limit}&offset=${offset}`,
            signal,
          )) as unknown as TableData;
          return { fields: d.fields, rows: d.rows, total: d.totalRows };
        },
        columns(page, all) {
          const cols = all.structure as ColumnInfo[] | undefined;
          return page.fields.map((f) => {
            const col = cols?.find((c) => c.name === f.name);
            return {
              name: f.name,
              hint: `${col?.dataType ?? f.dataType}${col && !col.isNullable ? " · NOT NULL" : ""}`,
              isPrimaryKey: !!col?.isPrimaryKey,
            };
          });
        },
      },
      errorTitles: { stats: "Could not load statistics" },
      skeleton: {
        stats: (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ),
        ddl: <Skeleton className="h-40 w-full" />,
      },
      toolbar: {
        indexes: ({ all }) => (
          <IndexesToolbar
            indexes={all.indexes as IndexInfo[] | undefined}
            canCreate={all.structure !== undefined}
            onCreate={() => setCreateIndexOpen(true)}
          />
        ),
      },
      render: {
        structure: ({ data, all }) => (
          <StructurePanel
            columns={toSqlColumns(data as ColumnInfo[])}
            extraChips={(c) => fkChips(c.name, all.foreign_keys as ForeignKeyInfo[] | undefined)}
            action={
              <Button size="sm" variant="outline" onClick={() => setModifyOpen(true)}>
                <Wand2 className="size-3.5" />
                Modify columns
              </Button>
            }
          />
        ),
        indexes: ({ data }) => (
          <IndexesPanel
            indexes={data as IndexInfo[]}
            onRename={setRenameIdx}
            onDrop={setDropIdx}
          />
        ),
        constraints: ({ data }) => <ConstraintsPanel constraints={data as ConstraintInfo[]} />,
        foreign_keys: ({ data }) => (
          <ForeignKeysPanel foreignKeys={data as ForeignKeyInfo[]} />
        ),
        ddl: ({ data }) => <DdlPanel label="generated CREATE TABLE" ddl={data as string} />,
        stats: ({ data, all }) => (
          <StatsGrid
            stats={data as TableStats}
            columnCount={(all.structure as ColumnInfo[] | undefined)?.length ?? null}
            indexCount={(all.indexes as IndexInfo[] | undefined)?.length ?? null}
          />
        ),
      },
    }),
    [],
  );

  async function performDelete(ctl: TableDetailControl) {
    const columns = (ctl.all.structure as ColumnInfo[] | undefined) ?? [];
    if (!deleteRow) return;
    const pk = columns
      .filter((c) => c.isPrimaryKey)
      .map((c) => ({ column: c.name, value: deleteRow[c.name] ?? null }));
    setDeleting(true);
    try {
      const res = await fetch(`${base}/rows`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pk }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Row deleted");
        setDeleteRow(null);
        ctl.reloadData();
      } else {
        toast.error("Delete failed", { description: data.error });
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SqlTableDetail
      descriptor={descriptor}
      ctx={ctx}
      title={
        <span className="font-mono">
          {schema}.{table}
        </span>
      }
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
            onClick={() => setModifyOpen(true)}
            disabled={ctl.all.structure === undefined}
            title="Add / drop / rename columns"
          >
            <Wand2 className="size-3.5" />
            Modify
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDropOpen(true)}
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
        const columns = ctl.all.structure as ColumnInfo[] | undefined;
        const label = (
          <span className="font-mono text-foreground/80">
            {schema}.{table}
          </span>
        );
        return (
          <>
            {columns ? (
              <>
                <RowFormDialog
                  open={insertOpen}
                  onOpenChange={setInsertOpen}
                  mode="insert"
                  base={base}
                  title="Insert row"
                  description={label}
                  columns={toSqlColumns(columns)}
                  dialect={postgresRowDialect}
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
                  columns={toSqlColumns(columns)}
                  initialRow={editRow ?? undefined}
                  dialect={postgresRowDialect}
                  onSuccess={() => ctl.reloadData()}
                />
              </>
            ) : null}

            <CreateIndexDialog
              open={createIndexOpen}
              onOpenChange={setCreateIndexOpen}
              connectionId={connectionId}
              db={db}
              schema={schema}
              table={table}
              availableColumns={columns?.map((c) => c.name) ?? []}
              onCreated={() => {
                ctl.refresh("indexes");
                if (ctl.tab !== "indexes") ctl.setTab("indexes");
              }}
            />

            <IndexActionDialogs
              base={base}
              schema={schema}
              renameTarget={renameIdx}
              dropTarget={dropIdx}
              onClose={() => {
                setRenameIdx(null);
                setDropIdx(null);
              }}
              onChanged={() => ctl.refresh("indexes")}
            />

            <ModifyTableDialog
              open={modifyOpen}
              onOpenChange={setModifyOpen}
              connectionId={connectionId}
              db={db}
              schema={schema}
              table={table}
              columns={columns ?? []}
              onApplied={() => ctl.refresh("structure", "data")}
            />

            <DropConfirm
              open={dropOpen}
              onOpenChange={setDropOpen}
              connectionId={connectionId}
              target={dropOpen ? dropTarget : null}
              onDropped={() => {
                router.push(
                  `/postgres/${connectionId}/databases/${encodeURIComponent(db)}/query`,
                );
              }}
            />

            <ConfirmDialog
              open={deleteRow !== null}
              onOpenChange={() => setDeleteRow(null)}
              title="Delete row?"
              description={
                <>
                  This will run{" "}
                  <span className="font-mono">
                    DELETE FROM {schema}.{table}
                  </span>{" "}
                  for the selected row. This cannot be undone.
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
