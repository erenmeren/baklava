"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { ErrorState } from "@/components/workspace/error-state";
import { StructurePanel } from "@/components/workspace/sql/structure-panel";
import { DdlPanel } from "@/components/workspace/sql/ddl-panel";
import { MetaTable, type MetaColumn } from "@/components/workspace/sql/meta-table";
import type { SqlColumn } from "@/components/workspace/sql/types";
import { DataGrid, type GridColumn } from "@/components/workspace/sql/data-grid";
import { cn } from "@/lib/utils";
import { Plus, Trash, Wand2 } from "lucide-react";
import { RowFormDialog, type ColumnInfo as RowColumnInfo } from "./row-form-dialog";
import { ModifyTableDialog } from "../../../../../modify-table-dialog";
import { DropConfirm } from "../../../../../drop-confirm";
import { DataPagination } from "@/components/sql/pagination";

interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  identitySeed: string | null;
  identityIncrement: string | null;
  isComputed: boolean;
  computedDefinition: string | null;
  isPrimaryKey: boolean;
  defaultDefinition: string | null;
  maxLength: number | null;
}
interface Index {
  name: string;
  typeDesc: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
  keyColumns: string[];
  includedColumns: string[];
  sizeBytes: number;
  userSeeks: number;
  userScans: number;
  userLookups: number;
  userUpdates: number;
  unused: boolean;
}
interface ConstraintRow {
  name: string;
  type: string;
  definition: string;
}
interface ForeignKeyRow {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}
interface Detail {
  schema: string;
  table: string;
  isHeap: boolean;
  rowCount: number;
  columns: Column[];
  indexes: Index[];
  constraints: ConstraintRow[];
  foreignKeys: ForeignKeyRow[];
}
interface TableData {
  fields: string[];
  rows: unknown[][];
  total: number;
}

interface Props {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function TableDetailClient({ connectionId, database, schema, table }: Props) {
  const base = `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
  const [tab, setTab] = useState("data");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [data, setData] = useState<TableData | null>(null);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [loadingData, setLoadingData] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
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

  const rowColumns: RowColumnInfo[] = (detail?.columns ?? []).map((c) => ({
    name: c.name,
    dataType: c.dataType,
    nullable: c.nullable,
    isIdentity: c.isIdentity,
    defaultDefinition: c.defaultDefinition,
    isPrimaryKey: c.isPrimaryKey,
  }));

  // SqlServerColumn carries no ordinal field, so position comes from the
  // array index: getSqlServerTableDetail's catalog query returns columns in
  // ordinal order, which is the only ordering the Structure tab ever showed.
  const sqlColumns: SqlColumn[] = (detail?.columns ?? []).map((c, i) => ({
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

  const gridColumns: GridColumn[] = (data?.fields ?? []).map((f) => {
    const col = detail?.columns.find((c) => c.name === f);
    return {
      name: f,
      hint: `${col?.dataType ?? ""}${col && !col.nullable ? " · NOT NULL" : ""}`,
      isPrimaryKey: !!col?.isPrimaryKey,
    };
  });

  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
      setDetail(d as Detail);
      setDetailError(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
      setDetail(null);
    }
  }, [base]);

  const loadData = useCallback(
    async (off: number, limit: number = pageSize) => {
      setLoadingData(true);
      try {
        const res = await fetch(
          `${base}/data?offset=${off}&limit=${limit}`,
          { cache: "no-store" },
        );
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
        setData(d as TableData);
        setDataError(null);
      } catch (err) {
        setDataError(err instanceof Error ? err.message : String(err));
        // Null the cached rows so Retry can re-satisfy the effect's guard.
        // Without this, a failure that follows a success leaves `data`
        // non-null, clearing the error alone never re-opens the guard, and
        // Retry is a dead button. Postgres and MySQL both hit this.
        setData(null);
      } finally {
        setLoadingData(false);
      }
    },
    [base, pageSize],
  );

  // Both effects below are the SOLE callers of their loader on the retry
  // path — onRetry only clears the error state, it never calls the loader
  // itself. Clearing the error re-opens the guard (cache null + error
  // null), and the effect fires again. An explicit call in onRetry would
  // double-fire: clearing the error re-opens the guard *and* onRetry calls
  // the loader, racing an uncancelled duplicate request.
  useEffect(() => {
    if (!detail && !detailError) void loadDetail();
  }, [detail, detailError, loadDetail]);
  useEffect(() => {
    if (tab === "data" && !data && !dataError) void loadData(offset);
  }, [tab, data, dataError, offset, loadData]);

  const ddl = detail ? buildClientDdl(detail) : "";

  const indexColumns: MetaColumn<Index>[] = [
    {
      header: "Name",
      className: () => "font-mono text-xs",
      cell: (i) => (
        <span className="inline-flex items-center gap-1.5">
          {i.name}
          {i.isPrimaryKey ? <Badge>PK</Badge> : null}
          {i.isUnique && !i.isPrimaryKey ? (
            <Badge variant="secondary">unique</Badge>
          ) : null}
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
          i.userSeeks + i.userScans === 0
            ? "text-amber-600"
            : "text-muted-foreground",
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

  return (
    <WorkspacePage
      title={
        <span className="font-mono">
          {schema}.{table}
        </span>
      }
      description={
        detail
          ? `${detail.rowCount.toLocaleString()} rows · ${detail.columns.length} columns${detail.isHeap ? " · HEAP (no clustered index)" : ""}`
          : `database ${database}`
      }
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModifyOpen(true)}
            disabled={!detail}
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
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="indexes">Indexes</TabsTrigger>
          <TabsTrigger value="constraints">Constraints</TabsTrigger>
          <TabsTrigger value="foreign_keys">Foreign keys</TabsTrigger>
          <TabsTrigger value="ddl">DDL</TabsTrigger>
        </TabsList>

        {/* DATA */}
        <TabsContent value="data" className="pt-4 flex-1 min-h-0 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {data
                ? `${data.total.toLocaleString()} row${data.total === 1 ? "" : "s"}`
                : "Loading…"}
            </p>
            <Button
              size="sm"
              onClick={() => setInsertOpen(true)}
              disabled={!detail}
              className={cn(
                "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-500/40",
              )}
            >
              <Plus className="size-3.5" />
              Insert row
            </Button>
          </div>
          {dataError ? (
            <ErrorState
              title="Could not load data"
              message={dataError}
              onRetry={() => setDataError(null)}
            />
          ) : !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              {detailError ? (
                <ErrorState
                  title="Could not load column metadata"
                  message={detailError}
                  onRetry={() => setDetailError(null)}
                  className="px-3 py-2 shrink-0"
                />
              ) : null}
              <DataGrid
                columns={gridColumns}
                rows={data.rows}
                density="compact"
                empty="No rows."
                className="flex-1 min-h-0"
              />
              <DataPagination
                offset={offset}
                pageSize={pageSize}
                total={data.total}
                loading={loadingData}
                onOffsetChange={(next) => {
                  setOffset(next);
                  void loadData(next);
                }}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setOffset(0);
                  void loadData(0, size);
                }}
              />
            </>
          )}
        </TabsContent>

        {/* STRUCTURE */}
        <TabsContent value="structure" className="pt-4">
          {detailError ? (
            <ErrorState
              title="Could not load table"
              message={detailError}
              onRetry={() => setDetailError(null)}
            />
          ) : !detail ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <StructurePanel columns={sqlColumns} />
          )}
        </TabsContent>

        {/* INDEXES */}
        <TabsContent value="indexes" className="pt-4">
          {detailError ? (
            <ErrorState
              title="Could not load table"
              message={detailError}
              onRetry={() => setDetailError(null)}
            />
          ) : !detail ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <MetaTable
              items={detail.indexes}
              columns={indexColumns}
              rowKey={(i) => i.name}
              rowClassName={(i) => (i.unused ? "bg-amber-500/5" : undefined)}
              empty="No indexes."
            />
          )}
        </TabsContent>

        {/* CONSTRAINTS */}
        <TabsContent value="constraints" className="pt-4">
          {detailError ? (
            <ErrorState
              title="Could not load table"
              message={detailError}
              onRetry={() => setDetailError(null)}
            />
          ) : !detail ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <MetaTable
              items={detail.constraints}
              columns={constraintColumns}
              rowKey={(c) => c.name}
              empty="No check/default constraints."
            />
          )}
        </TabsContent>

        {/* FOREIGN KEYS */}
        <TabsContent value="foreign_keys" className="pt-4">
          {detailError ? (
            <ErrorState
              title="Could not load table"
              message={detailError}
              onRetry={() => setDetailError(null)}
            />
          ) : !detail ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <MetaTable
              items={detail.foreignKeys}
              columns={foreignKeyColumns}
              rowKey={(f) => f.name}
              empty="No foreign keys."
            />
          )}
        </TabsContent>

        {/* DDL */}
        <TabsContent value="ddl" className="pt-4">
          {detailError ? (
            <ErrorState
              title="Could not load table"
              message={detailError}
              onRetry={() => setDetailError(null)}
            />
          ) : !detail ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <DdlPanel label="generated CREATE TABLE" ddl={ddl} />
          )}
        </TabsContent>
      </Tabs>

      {detail ? (
        <>
          <RowFormDialog
            open={insertOpen}
            onOpenChange={setInsertOpen}
            mode="insert"
            base={base}
            schema={schema}
            table={table}
            columns={rowColumns}
            onSuccess={() => {
              setOffset(0);
              void loadData(0);
              void loadDetail();
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
            onApplied={() => {
              setData(null);
              void loadDetail();
              void loadData(offset);
            }}
          />
          <DropConfirm
            open={dropOpen}
            onOpenChange={setDropOpen}
            connectionId={connectionId}
            target={
              dropOpen
                ? {
                    kind: "object",
                    database,
                    schema,
                    name: table,
                    objectKind: "table",
                  }
                : null
            }
            onDropped={() => {
              router.push(
                `/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}`,
              );
            }}
          />
        </>
      ) : null}
    </WorkspacePage>
  );
}

// Mirror of buildSqlServerTableDDL on the client so we don't round-trip for DDL.
function buildClientDdl(d: Detail): string {
  const colLines = d.columns.map((c) => {
    const parts = [`  [${c.name}]`];
    if (c.isComputed && c.computedDefinition) {
      parts.push(`AS ${c.computedDefinition}`);
    } else {
      parts.push(c.dataType);
      if (c.isIdentity) parts.push(`IDENTITY(${c.identitySeed ?? 1},${c.identityIncrement ?? 1})`);
      parts.push(c.nullable ? "NULL" : "NOT NULL");
      if (c.defaultDefinition) parts.push(`DEFAULT ${c.defaultDefinition}`);
    }
    return parts.join(" ");
  });
  const pk = d.columns.filter((c) => c.isPrimaryKey).map((c) => `[${c.name}]`);
  const lines = [...colLines];
  if (pk.length) lines.push(`  PRIMARY KEY (${pk.join(", ")})`);
  const create = `CREATE TABLE [${d.schema}].[${d.table}] (\n${lines.join(",\n")}\n);`;
  const idx = d.indexes
    .filter((i) => !i.isPrimaryKey && i.name !== "(heap)" && i.keyColumns.length > 0)
    .map((i) => {
      const unique = i.isUnique ? "UNIQUE " : "";
      const clustered =
        i.typeDesc.includes("CLUSTERED") && !i.typeDesc.includes("NONCLUSTERED")
          ? "CLUSTERED "
          : "NONCLUSTERED ";
      const incl = i.includedColumns.length
        ? ` INCLUDE (${i.includedColumns.map((c) => `[${c}]`).join(", ")})`
        : "";
      return `CREATE ${unique}${clustered}INDEX [${i.name}] ON [${d.schema}].[${d.table}] (${i.keyColumns
        .map((c) => `[${c}]`)
        .join(", ")})${incl};`;
    });
  const fk = d.foreignKeys.map(
    (f) =>
      `ALTER TABLE [${d.schema}].[${d.table}] ADD CONSTRAINT [${f.name}] FOREIGN KEY (${f.columns
        .map((c) => `[${c}]`)
        .join(", ")}) REFERENCES [${f.refSchema}].[${f.refTable}] (${f.refColumns
        .map((c) => `[${c}]`)
        .join(", ")});`,
  );
  return [create, ...idx, ...fk].join("\n\n");
}
