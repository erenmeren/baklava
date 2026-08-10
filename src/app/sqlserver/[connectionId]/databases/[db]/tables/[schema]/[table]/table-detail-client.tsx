"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StructurePanel } from "@/components/workspace/sql/structure-panel";
import { DdlPanel } from "@/components/workspace/sql/ddl-panel";
import type { SqlColumn } from "@/components/workspace/sql/types";
import { SqlTableDetail } from "@/components/workspace/sql/sql-table-detail";
import type { SqlTableDetailDescriptor } from "@/components/workspace/sql/descriptor";
import { Trash, Wand2 } from "lucide-react";
import { RowFormDialog } from "@/components/workspace/sql/row-form-dialog";
import { sqlserverRowDialect } from "./row-dialect";
import { ModifyTableDialog } from "../../../../../modify-table-dialog";
import { DropConfirm } from "../../../../../drop-confirm";
import { ConstraintsPanel, ForeignKeysPanel, IndexesPanel } from "./meta-columns";
import { buildClientDdl, type Column, type Detail } from "./table-types";

interface Props {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

interface Ctx {
  base: string;
}

const ROSE_INSERT =
  "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-500/40";

async function getJson(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: "no-store", signal });
  const d = await res.json();
  if (!res.ok) throw new Error((d.error as string) || `Request failed (${res.status})`);
  return d;
}

/**
 * The Structure tab's column model. `default` folds in computed-column
 * definitions and `extra` carries the display "IDENTITY(seed,increment)" —
 * both different from `rowColumns` below, which RowFormDialog reads.
 */
function toSqlColumns(columns: Column[]): SqlColumn[] {
  // SqlServerColumn carries no ordinal field, so position comes from the array
  // index: getSqlServerTableDetail returns columns in ordinal order, which is
  // the only ordering the Structure tab ever showed.
  return columns.map((c, i) => ({
    name: c.name,
    position: i + 1,
    dataType: c.dataType,
    nullable: c.nullable,
    default: c.isComputed ? c.computedDefinition : c.defaultDefinition,
    isPrimaryKey: c.isPrimaryKey,
    extra: c.isIdentity
      ? `IDENTITY(${c.identitySeed},${c.identityIncrement})`
      : c.isComputed
        ? "computed"
        : null,
  }));
}

/** RowFormDialog's column model — raw defaults, and the dialect's own
 *  "identity" marker in `extra` (see row-dialect.tsx). */
function toRowColumns(columns: Column[]): SqlColumn[] {
  return columns.map((c, i) => ({
    name: c.name,
    position: i + 1,
    dataType: c.dataType,
    nullable: c.nullable,
    default: c.defaultDefinition,
    isPrimaryKey: c.isPrimaryKey,
    extra: c.isIdentity ? "identity" : null,
  }));
}

export function TableDetailClient({ connectionId, database, schema, table }: Props) {
  const base = `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
  const ctx = useMemo<Ctx>(() => ({ base }), [base]);

  const [insertOpen, setInsertOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);

  // Sidebar's "Modify…" navigates here with ?modify=1 — open the dialog
  // on arrival and strip the query string so a refresh doesn't reopen it.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("modify") === "1") {
      setModifyOpen(true);
      router.replace(pathname);
    }
  }, [searchParams, router, pathname]);

  const descriptor = useMemo<SqlTableDetailDescriptor<Ctx>>(() => {
    const tableError = "Could not load table";
    return {
      tech: "sqlserver",
      tabs: ["data", "structure", "indexes", "constraints", "foreign_keys", "ddl"],
      // Row edit and delete land in Task 12 — the driver and route exist.
      capabilities: { insertRow: true, editRow: false, deleteRow: false },
      paths: { base: (c) => c.base, rows: (c) => `${c.base}/rows` },
      load: {
        strategy: "single",
        fetchAll: (c, signal) => getJson(c.base, signal),
      },
      data: {
        schemaTab: "structure",
        insertClassName: ROSE_INSERT,
        gridClassName: "flex-1 min-h-0",
        async fetch(c, { offset, limit }, signal) {
          const d = (await getJson(
            `${c.base}/data?offset=${offset}&limit=${limit}`,
            signal,
          )) as unknown as { fields: string[]; rows: unknown[][]; total: number };
          return {
            fields: d.fields.map((name) => ({ name })),
            rows: d.rows,
            total: d.total,
          };
        },
        columns(page, all) {
          const detail = all.structure as Detail | undefined;
          return page.fields.map((f) => {
            const col = detail?.columns.find((c) => c.name === f.name);
            return {
              name: f.name,
              hint: `${col?.dataType ?? ""}${col && !col.nullable ? " · NOT NULL" : ""}`,
              isPrimaryKey: !!col?.isPrimaryKey,
            };
          });
        },
      },
      errorTitles: {
        structure: tableError,
        indexes: tableError,
        constraints: tableError,
        foreign_keys: tableError,
        ddl: tableError,
      },
      contentClassName: { data: "flex-1 min-h-0 flex flex-col gap-2" },
      // One tall block on every tab, as the hand-written version had.
      skeleton: {
        data: <Skeleton className="h-40 w-full" />,
        structure: <Skeleton className="h-40 w-full" />,
        indexes: <Skeleton className="h-40 w-full" />,
        constraints: <Skeleton className="h-40 w-full" />,
        foreign_keys: <Skeleton className="h-40 w-full" />,
        ddl: <Skeleton className="h-40 w-full" />,
      },
      render: {
        structure: ({ data }) => (
          <StructurePanel columns={toSqlColumns((data as Detail).columns)} />
        ),
        indexes: ({ data }) => <IndexesPanel indexes={(data as Detail).indexes} />,
        constraints: ({ data }) => (
          <ConstraintsPanel constraints={(data as Detail).constraints} />
        ),
        foreign_keys: ({ data }) => (
          <ForeignKeysPanel foreignKeys={(data as Detail).foreignKeys} />
        ),
        ddl: ({ data }) => (
          <DdlPanel label="generated CREATE TABLE" ddl={buildClientDdl(data as Detail)} />
        ),
      },
    };
  }, []);

  return (
    <SqlTableDetail
      descriptor={descriptor}
      ctx={ctx}
      title={
        <span className="font-mono">
          {schema}.{table}
        </span>
      }
      description={(ctl) => {
        const detail = ctl.all.structure as Detail | undefined;
        return detail
          ? `${detail.rowCount.toLocaleString()} rows · ${detail.columns.length} columns${detail.isHeap ? " · HEAP (no clustered index)" : ""}`
          : `database ${database}`;
      }}
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
    >
      {(ctl) => {
        const detail = ctl.all.structure as Detail | undefined;
        if (!detail) return null;
        return (
          <>
            <RowFormDialog
              open={insertOpen}
              onOpenChange={setInsertOpen}
              mode="insert"
              base={base}
              title="Insert row"
              description={
                <span className="font-mono text-foreground/80">
                  {schema}.{table}
                </span>
              }
              columns={toRowColumns(detail.columns)}
              dialect={sqlserverRowDialect}
              onSuccess={() => {
                // A fresh row lands on page 1 under the table's default
                // ordering, so jump back there rather than reloading the
                // page the user happened to be on.
                ctl.reloadData(0);
                ctl.refresh("structure");
              }}
            />
            <ModifyTableDialog
              open={modifyOpen}
              onOpenChange={setModifyOpen}
              connectionId={connectionId}
              db={database}
              schema={schema}
              table={table}
              columns={detail.columns}
              onApplied={() => ctl.refresh("data", "structure")}
            />
            <DropConfirm
              open={dropOpen}
              onOpenChange={setDropOpen}
              connectionId={connectionId}
              target={
                dropOpen
                  ? { kind: "object", database, schema, name: table, objectKind: "table" }
                  : null
              }
              onDropped={() => {
                router.push(
                  `/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}`,
                );
              }}
            />
          </>
        );
      }}
    </SqlTableDetail>
  );
}
