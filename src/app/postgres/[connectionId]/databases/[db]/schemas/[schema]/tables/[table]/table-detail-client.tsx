"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { ErrorState } from "@/components/workspace/error-state";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { DataPagination } from "@/components/sql/pagination";
import { StructurePanel } from "@/components/workspace/sql/structure-panel";
import { DdlPanel } from "@/components/workspace/sql/ddl-panel";
import { MetaTable, type MetaColumn } from "@/components/workspace/sql/meta-table";
import type { SqlColumn } from "@/components/workspace/sql/types";
import {
  DataGrid,
  GridToolbar,
  filterRows,
  type GridColumn,
} from "@/components/workspace/sql/data-grid";
import {
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wand2,
  Trash,
} from "lucide-react";
import { toast } from "sonner";
import { RowFormDialog, type ColumnInfo } from "./row-form-dialog";
import { DropConfirm, type DropTarget } from "../../../../../../drop-confirm";
import { ModifyTableDialog } from "../../../../../../modify-table-dialog";
import { CreateIndexDialog } from "./create-index-dialog";
import { cn } from "@/lib/utils";

interface IndexInfo {
  name: string;
  definition: string;
  isUnique: boolean;
  isPrimary: boolean;
  sizeBytes: number;
  scans: number;
  tuplesRead: number;
  tuplesFetched: number;
  unused: boolean;
}

interface ConstraintInfo {
  name: string;
  type: string;
  definition: string;
}

interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}

interface TableStats {
  relKind: string;
  analyzed: boolean;
  rowEstimate: number;
  totalSize: number;
  tableSize: number;
  indexSize: number;
  toastSize: number;
  liveTuples: number;
  deadTuples: number;
  seqScan: number;
  seqTupRead: number;
  idxScan: number;
  idxTupFetch: number;
  nTupIns: number;
  nTupUpd: number;
  nTupDel: number;
  nTupHotUpd: number;
  vacuumCount: number;
  autovacuumCount: number;
  analyzeCount: number;
  autoanalyzeCount: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
}

interface TableData {
  fields: { name: string; dataType: string }[];
  rows: unknown[][];
  rowCount: number;
  totalRows: number | null;
}

interface Props {
  connectionId: string;
  db: string;
  schema: string;
  table: string;
}

type ViewKey = "data" | "structure" | "indexes" | "constraints" | "foreign_keys" | "ddl" | "stats";

export function TableDetailClient({
  connectionId,
  db,
  schema,
  table,
}: Props) {
  const base = `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}`;

  const [tab, setTab] = useState("data");

  const [columns, setColumns] = useState<ColumnInfo[] | null>(null);
  const [indexes, setIndexes] = useState<IndexInfo[] | null>(null);
  const [constraints, setConstraints] = useState<ConstraintInfo[] | null>(null);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[] | null>(null);
  const [ddl, setDdl] = useState<string | null>(null);
  const [stats, setStats] = useState<TableStats | null>(null);

  const [pageData, setPageData] = useState<TableData | null>(null);
  const [pageLimit, setPageLimit] = useState(100);
  const [pageOffset, setPageOffset] = useState(0);
  const [loadingData, setLoadingData] = useState(false);

  const [errors, setErrors] = useState<Partial<Record<ViewKey, string>>>({});
  const clearError = useCallback((view: ViewKey) => {
    setErrors((prev) => {
      if (!(view in prev)) return prev;
      const next = { ...prev };
      delete next[view];
      return next;
    });
  }, []);

  const [insertOpen, setInsertOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    fields: { name: string }[];
    cells: unknown[];
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    fields: { name: string }[];
    cells: unknown[];
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // DataGrip-style affordances
  const [filter, setFilter] = useState("");
  const [density, setDensity] = useState<"compact" | "normal">("compact");
  const [modifyOpen, setModifyOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [createIndexOpen, setCreateIndexOpen] = useState(false);
  const [renameIdxTarget, setRenameIdxTarget] = useState<string | null>(null);
  const [renameIdxValue, setRenameIdxValue] = useState("");
  const [dropIdxTarget, setDropIdxTarget] = useState<string | null>(null);
  const [idxWorking, setIdxWorking] = useState(false);
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

  const dropTarget: DropTarget = {
    kind: "table",
    database: db,
    schema,
    name: table,
  };

  const fetchView = useCallback(
    async (
      view: "structure" | "indexes" | "constraints" | "foreign_keys"
    ): Promise<unknown> => {
      try {
        const res = await fetch(`${base}?view=${view}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        clearError(view);
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrors((prev) => ({ ...prev, [view]: message }));
        throw err;
      }
    },
    [base, clearError]
  );

  const loadData = useCallback(
    async (offset: number, limit: number = pageLimit) => {
      setLoadingData(true);
      try {
        const res = await fetch(
          `${base}?view=data&limit=${limit}&offset=${offset}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        setPageData(data as TableData);
        clearError("data");
      } catch (err) {
        // Null pageData too, not just the error — Retry now only clears the
        // error key (see the Data tab's onRetry) and relies on the lazy-tab
        // effect's `pageData === null && !errors.data` guard to re-fire. If a
        // *later* page load fails (pagination, refresh) while pageData still
        // holds the previous page's rows, leaving it non-null would starve
        // that guard forever: clearing the error alone would fall through to
        // re-rendering the stale old page instead of issuing a new request.
        // The render already checks `errors.data` before `pageData`, so this
        // doesn't cause any stale-data flash while `errors.data` is set.
        setPageData(null);
        setErrors((prev) => ({
          ...prev,
          data: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setLoadingData(false);
      }
    },
    [base, pageLimit, clearError]
  );

  useEffect(() => {
    setColumns(null);
    setIndexes(null);
    setConstraints(null);
    setForeignKeys(null);
    setDdl(null);
    setStats(null);
    setPageData(null);
    setPageOffset(0);
    // Functional form so this bails out (same `{}` reference) when errors is
    // already empty — otherwise this always-runs-on-mount effect hands the
    // lazy-tab effect below a brand-new object every time, since it lists
    // `errors` in its dependency array, and that spurious "change" makes it
    // re-fire once immediately after mount, before the first fetch settles.
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [base]);

  useEffect(() => {
    if (columns === null && !errors.structure) {
      fetchView("structure")
        .then((d) => setColumns((d as { columns: ColumnInfo[] }).columns))
        .catch(() => undefined);
    }
  }, [columns, fetchView, errors.structure]);

  useEffect(() => {
    if (tab === "structure" && columns && foreignKeys === null && !errors.foreign_keys) {
      fetchView("foreign_keys")
        .then((d) =>
          setForeignKeys(
            (d as { foreignKeys: ForeignKeyInfo[] }).foreignKeys,
          ),
        )
        .catch(() => undefined);
    } else if (tab === "indexes" && indexes === null && !errors.indexes) {
      fetchView("indexes")
        .then((d) => setIndexes((d as { indexes: IndexInfo[] }).indexes))
        .catch(() => undefined);
    } else if (tab === "constraints" && constraints === null && !errors.constraints) {
      fetchView("constraints")
        .then((d) =>
          setConstraints(
            (d as { constraints: ConstraintInfo[] }).constraints
          )
        )
        .catch(() => undefined);
    } else if (tab === "foreign_keys" && foreignKeys === null && !errors.foreign_keys) {
      fetchView("foreign_keys")
        .then((d) =>
          setForeignKeys(
            (d as { foreignKeys: ForeignKeyInfo[] }).foreignKeys
          )
        )
        .catch(() => undefined);
    } else if (tab === "ddl" && ddl === null && !errors.ddl) {
      fetch(`${base}?view=ddl`, { cache: "no-store" })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not load DDL");
          setDdl(data.ddl as string);
        })
        .catch((err) => {
          setErrors((prev) => ({
            ...prev,
            ddl: err instanceof Error ? err.message : String(err),
          }));
        });
    } else if (tab === "stats" && stats === null && !errors.stats) {
      fetch(`${base}?view=stats`, { cache: "no-store" })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not load stats");
          setStats(data.stats as TableStats);
        })
        .catch((err) => {
          setErrors((prev) => ({
            ...prev,
            stats: err instanceof Error ? err.message : String(err),
          }));
        });
    } else if (tab === "data" && pageData === null && !errors.data) {
      loadData(pageOffset);
    }
  }, [tab, columns, indexes, constraints, foreignKeys, ddl, stats, pageData, pageOffset, base, fetchView, loadData, errors]);

  const filteredRows = useMemo(
    () => filterRows(pageData?.rows ?? [], filter),
    [pageData, filter],
  );

  const gridColumns: GridColumn[] = useMemo(
    () =>
      (pageData?.fields ?? []).map((f) => {
        const col = columns?.find((c) => c.name === f.name);
        return {
          name: f.name,
          hint: `${col?.dataType ?? f.dataType}${col && !col.isNullable ? " · NOT NULL" : ""}`,
          isPrimaryKey: !!col?.isPrimaryKey,
        };
      }),
    [pageData, columns],
  );

  const pkColumns = columns?.filter((c) => c.isPrimaryKey) ?? [];
  const canMutateRows = pkColumns.length > 0;
  const noPkReason = "This table has no primary key";

  const performDelete = async () => {
    if (!deleteTarget || !columns) return;
    const byName = new Map<string, unknown>();
    deleteTarget.fields.forEach((f, i) =>
      byName.set(f.name, deleteTarget.cells[i])
    );
    const pk = pkColumns.map((c) => ({
      column: c.name,
      value: byName.get(c.name) ?? null,
    }));
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
        setDeleteTarget(null);
        loadData(pageOffset);
      } else {
        toast.error("Delete failed", { description: data.error });
      }
    } finally {
      setDeleting(false);
    }
  };

  const sqlColumns: SqlColumn[] = (columns ?? []).map((c) => ({
    name: c.name,
    position: c.position,
    dataType: c.dataType,
    nullable: c.isNullable,
    default: c.default,
    isPrimaryKey: c.isPrimaryKey,
    isUnique: c.isUnique,
    comment: c.comment,
  }));

  const indexColumns: MetaColumn<IndexInfo>[] = [
    {
      header: "Name",
      cell: (i) => (
        <div className="font-mono text-xs flex items-center gap-2">
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
      cell: (i) => (
        <span className="space-x-1">
          {i.isPrimary ? <Badge>primary</Badge> : null}
          {i.isUnique && !i.isPrimary ? (
            <Badge variant="secondary">unique</Badge>
          ) : null}
        </span>
      ),
    },
    {
      header: "Size",
      align: "right",
      cell: (i) => (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatBytes(i.sizeBytes)}
        </span>
      ),
    },
    {
      header: "Scans",
      align: "right",
      cell: (i) => (
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            i.scans === 0 ? "text-amber-600" : "text-muted-foreground",
          )}
        >
          {i.scans.toLocaleString()}
        </span>
      ),
    },
    {
      header: "Tuples read",
      align: "right",
      cell: (i) => (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {i.tuplesRead.toLocaleString()}
        </span>
      ),
    },
    {
      header: "Definition",
      cell: (i) => (
        <span className="font-mono text-[11px] text-muted-foreground break-all">
          {i.definition}
        </span>
      ),
    },
    {
      header: null,
      headClassName: "w-px",
      cell: (i) => (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={i.isPrimary}
            title={
              i.isPrimary
                ? "Primary key index can't be renamed here"
                : "Rename index"
            }
            onClick={() => {
              setRenameIdxTarget(i.name);
              setRenameIdxValue(i.name);
            }}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-destructive hover:text-destructive"
            disabled={i.isPrimary}
            title={
              i.isPrimary
                ? "Primary key index can't be dropped here"
                : "Drop index"
            }
            onClick={() => setDropIdxTarget(i.name)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const constraintColumns: MetaColumn<ConstraintInfo>[] = [
    {
      header: "Name",
      cell: (c) => <span className="font-mono text-xs">{c.name}</span>,
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
      cell: (c) => (
        <span className="font-mono text-[11px] text-muted-foreground break-all">
          {c.definition}
        </span>
      ),
    },
  ];

  const foreignKeyColumns: MetaColumn<ForeignKeyInfo>[] = [
    {
      header: "Name",
      cell: (fk) => <span className="font-mono text-xs">{fk.name}</span>,
    },
    {
      header: "Columns",
      cell: (fk) => (
        <span className="font-mono text-xs">{fk.columns.join(", ")}</span>
      ),
    },
    {
      header: "References",
      cell: (fk) => (
        <span className="font-mono text-xs">
          {fk.refSchema}.{fk.refTable} ({fk.refColumns.join(", ")})
        </span>
      ),
    },
    {
      header: "On update",
      cell: (fk) => <span className="font-mono text-xs">{fk.onUpdate}</span>,
    },
    {
      header: "On delete",
      cell: (fk) => <span className="font-mono text-xs">{fk.onDelete}</span>,
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
        <span className="text-xs">
          database <span className="font-mono">{db}</span>
        </span>
      }
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModifyOpen(true)}
            disabled={!columns}
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
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="pt-4 space-y-3">
          <GridToolbar
            filter={filter}
            onFilterChange={setFilter}
            density={density}
            onDensityChange={setDensity}
            status={
              <>
                {pageData?.totalRows != null
                  ? `${pageData.totalRows.toLocaleString()} rows`
                  : pageData
                    ? `${pageData.rowCount} on page`
                    : "…"}
                {pageData?.rowCount
                  ? ` · ${pageOffset + 1}–${pageOffset + pageData.rowCount}`
                  : ""}
                {filter.trim()
                  ? ` · ${filteredRows.length} match${filteredRows.length === 1 ? "" : "es"}`
                  : ""}
              </>
            }
          >
            <Button
              size="sm"
              onClick={() => setInsertOpen(true)}
              disabled={!columns}
            >
              <Plus className="size-3.5" />
              Insert row
            </Button>
            <RefreshButton
              onClick={() => loadData(pageOffset)}
              loading={loadingData}
            />
          </GridToolbar>
          {errors.data ? (
            <ErrorState
              title="Could not load data"
              message={errors.data}
              onRetry={() => clearError("data")}
            />
          ) : pageData ? (
            <>
              {errors.structure ? (
                <ErrorState
                  title="Could not load column metadata"
                  message={errors.structure}
                  onRetry={() => {
                    clearError("structure");
                    setColumns(null);
                  }}
                  className="px-3 py-2 mb-3"
                />
              ) : null}
              <DataGrid
                columns={gridColumns}
                rows={filteredRows}
                density={density}
                rowActions={(row) => (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={!canMutateRows}
                      title={canMutateRows ? "Edit row" : noPkReason}
                      onClick={() =>
                        setEditTarget({
                          fields: pageData.fields,
                          cells: row,
                        })
                      }
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-destructive hover:text-destructive"
                      disabled={!canMutateRows}
                      title={canMutateRows ? "Delete row" : noPkReason}
                      onClick={() =>
                        setDeleteTarget({
                          fields: pageData.fields,
                          cells: row,
                        })
                      }
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </>
                )}
                empty={
                  pageData.rows.length === 0
                    ? "No rows."
                    : `No rows match “${filter}”.`
                }
              />
            </>
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}
          {pageData ? (
            <DataPagination
              offset={pageOffset}
              pageSize={pageLimit}
              total={pageData.totalRows ?? null}
              loading={loadingData}
              onOffsetChange={(next) => {
                setPageOffset(next);
                loadData(next);
              }}
              onPageSizeChange={(size) => {
                setPageLimit(size);
                setPageOffset(0);
                loadData(0, size);
              }}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="structure" className="pt-4 space-y-3">
          {errors.structure ? (
            <ErrorState
              title="Could not load structure"
              message={errors.structure}
              onRetry={() => {
                clearError("structure");
                setColumns(null);
              }}
            />
          ) : columns ? (
            <StructurePanel
              columns={sqlColumns}
              extraChips={(c) =>
                columnFkLinks(c.name, foreignKeys).map((fk, i) => (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center px-1.5 py-px rounded border text-[10px] uppercase tracking-wider whitespace-nowrap",
                      "bg-foreground/5 text-foreground/80 border-border normal-case tracking-normal text-[10.5px]",
                    )}
                  >
                    → {fk.refSchema}.{fk.refTable}.{fk.refColumn}
                  </span>
                ))
              }
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setModifyOpen(true)}
                >
                  <Wand2 className="size-3.5" />
                  Modify columns
                </Button>
              }
            />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="indexes" className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground font-mono">
              {indexes ? `${indexes.length} index${indexes.length === 1 ? "" : "es"}` : "…"}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateIndexOpen(true)}
              disabled={!columns}
            >
              <Plus className="size-3.5" />
              New index
            </Button>
          </div>
          {errors.indexes ? (
            <ErrorState
              title="Could not load indexes"
              message={errors.indexes}
              onRetry={() => {
                clearError("indexes");
                setIndexes(null);
              }}
            />
          ) : indexes ? (
            <MetaTable
              items={indexes}
              columns={indexColumns}
              rowKey={(i) => i.name}
              rowClassName={(i) => (i.unused ? "bg-amber-500/5" : undefined)}
              empty="No indexes."
            />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="constraints" className="pt-4">
          {errors.constraints ? (
            <ErrorState
              title="Could not load constraints"
              message={errors.constraints}
              onRetry={() => {
                clearError("constraints");
                setConstraints(null);
              }}
            />
          ) : constraints ? (
            <MetaTable
              items={constraints}
              columns={constraintColumns}
              rowKey={(c) => c.name}
              empty="No constraints."
            />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="foreign_keys" className="pt-4">
          {errors.foreign_keys ? (
            <ErrorState
              title="Could not load foreign keys"
              message={errors.foreign_keys}
              onRetry={() => {
                clearError("foreign_keys");
                setForeignKeys(null);
              }}
            />
          ) : foreignKeys ? (
            <MetaTable
              items={foreignKeys}
              columns={foreignKeyColumns}
              rowKey={(fk) => fk.name}
              empty="No foreign keys."
            />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="ddl" className="pt-4">
          {errors.ddl ? (
            <ErrorState
              title="Could not load DDL"
              message={errors.ddl}
              onRetry={() => {
                clearError("ddl");
                setDdl(null);
              }}
            />
          ) : ddl === null ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <DdlPanel label="generated CREATE TABLE" ddl={ddl} />
          )}
        </TabsContent>

        <TabsContent value="stats" className="pt-4">
          {errors.stats ? (
            <ErrorState
              title="Could not load statistics"
              message={errors.stats}
              onRetry={() => {
                clearError("stats");
                setStats(null);
              }}
            />
          ) : stats ? (
            <StatsGrid stats={stats} columns={columns} indexes={indexes} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {columns ? (
        <>
          <RowFormDialog
            open={insertOpen}
            onOpenChange={setInsertOpen}
            mode="insert"
            base={base}
            schema={schema}
            table={table}
            columns={columns}
            onSuccess={() => loadData(pageOffset)}
          />
          <RowFormDialog
            open={editTarget !== null}
            onOpenChange={(v) => {
              if (!v) setEditTarget(null);
            }}
            mode="edit"
            base={base}
            schema={schema}
            table={table}
            columns={columns}
            initialRow={editTarget ?? undefined}
            onSuccess={() => loadData(pageOffset)}
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
          clearError("indexes");
          setIndexes(null);
          // Re-trigger the lazy fetcher on the indexes tab.
          if (tab !== "indexes") setTab("indexes");
        }}
      />

      <AlertDialog
        open={renameIdxTarget !== null}
        onOpenChange={(v) => {
          if (!v && !idxWorking) setRenameIdxTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename index</AlertDialogTitle>
            <AlertDialogDescription>
              ALTER INDEX{" "}
              <span className="font-mono">
                {schema}.{renameIdxTarget}
              </span>{" "}
              RENAME TO …
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={renameIdxValue}
            onChange={(e) => setRenameIdxValue(e.target.value)}
            disabled={idxWorking}
            spellCheck={false}
            className="font-mono h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
            placeholder="new_index_name"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={idxWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!renameIdxTarget || !renameIdxValue.trim()) return;
                setIdxWorking(true);
                try {
                  const res = await fetch(
                    `${base}/indexes/${encodeURIComponent(renameIdxTarget)}`,
                    {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ newName: renameIdxValue.trim() }),
                    },
                  );
                  const data = await res.json();
                  if (!res.ok) {
                    toast.error("Rename failed", { description: data.error });
                  } else {
                    toast.success("Index renamed");
                    clearError("indexes");
                    setIndexes(null);
                    setRenameIdxTarget(null);
                  }
                } finally {
                  setIdxWorking(false);
                }
              }}
              disabled={idxWorking || !renameIdxValue.trim()}
            >
              {idxWorking ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dropIdxTarget !== null}
        onOpenChange={(v) => {
          if (!v && !idxWorking) setDropIdxTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop index?</AlertDialogTitle>
            <AlertDialogDescription>
              This will run{" "}
              <span className="font-mono">
                DROP INDEX {schema}.{dropIdxTarget}
              </span>
              . This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={idxWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!dropIdxTarget) return;
                setIdxWorking(true);
                try {
                  const res = await fetch(
                    `${base}/indexes/${encodeURIComponent(dropIdxTarget)}`,
                    { method: "DELETE" },
                  );
                  const data = await res.json();
                  if (!res.ok) {
                    toast.error("Drop failed", { description: data.error });
                  } else {
                    toast.success("Index dropped");
                    clearError("indexes");
                    setIndexes(null);
                    setDropIdxTarget(null);
                  }
                } finally {
                  setIdxWorking(false);
                }
              }}
              disabled={idxWorking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {idxWorking ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Drop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ModifyTableDialog
        open={modifyOpen}
        onOpenChange={setModifyOpen}
        connectionId={connectionId}
        db={db}
        schema={schema}
        table={table}
        columns={columns ?? []}
        onApplied={() => {
          clearError("structure");
          setColumns(null);
          clearError("data");
          setPageData(null);
        }}
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete row?</AlertDialogTitle>
            <AlertDialogDescription>
              This will run{" "}
              <span className="font-mono">
                DELETE FROM {schema}.{table}
              </span>{" "}
              for the selected row. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                performDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  for (const u of units) {
    if (value < 1024) {
      return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${u}`;
    }
    value /= 1024;
  }
  return `${Math.round(value)} PB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 18) return `${mo}mo ago`;
  return `${Math.round(day / 365)}y ago`;
}

function StatsGrid({
  stats,
  columns,
  indexes,
}: {
  stats: TableStats;
  columns: ColumnInfo[] | null;
  indexes: IndexInfo[] | null;
}) {
  // Views and materialized views aren't tracked in pg_stat_user_tables, so the
  // numbers we'd render would all be zero. Show a clear empty state instead.
  if (stats.relKind === "v") {
    return (
      <UnsupportedKind
        title="Statistics aren't tracked for views"
        hint="Postgres doesn't record activity counters for plain views — they're computed on read from their underlying tables."
      />
    );
  }
  if (stats.relKind === "m") {
    return (
      <UnsupportedKind
        title="Limited statistics for materialized views"
        hint="Storage figures are accurate. Activity counters live on the source tables, not on the materialized view itself."
        showStorageOnly
        stats={stats}
      />
    );
  }

  // The "last vacuum" / "last analyze" we show is the more recent of manual + auto.
  const pickRecent = (a: string | null, b: string | null) => {
    if (!a) return b;
    if (!b) return a;
    return new Date(a) > new Date(b) ? a : b;
  };
  const lastVacuum = pickRecent(stats.lastVacuum, stats.lastAutovacuum);
  const lastAnalyze = pickRecent(stats.lastAnalyze, stats.lastAutoanalyze);

  const sections: Array<{
    title: string;
    items: Array<{ label: string; value: React.ReactNode; hint?: string }>;
  }> = [
    {
      title: "Storage",
      items: [
        {
          label: "Row estimate",
          value: stats.analyzed ? (
            formatNumber(stats.rowEstimate)
          ) : (
            <span className="text-muted-foreground/60 italic">—</span>
          ),
          hint: stats.analyzed
            ? "from pg_class.reltuples"
            : "run ANALYZE to populate",
        },
        { label: "Total size", value: formatBytes(stats.totalSize) },
        { label: "Table size", value: formatBytes(stats.tableSize) },
        { label: "Indexes size", value: formatBytes(stats.indexSize) },
        { label: "TOAST size", value: formatBytes(stats.toastSize) },
        {
          label: "Live tuples",
          value: formatNumber(stats.liveTuples),
        },
        {
          label: "Dead tuples",
          value: formatNumber(stats.deadTuples),
          hint:
            stats.deadTuples > stats.liveTuples * 0.2 && stats.liveTuples > 0
              ? "consider VACUUM"
              : undefined,
        },
      ],
    },
    {
      title: "Activity",
      items: [
        { label: "Sequential scans", value: formatNumber(stats.seqScan) },
        { label: "Seq tuples read", value: formatNumber(stats.seqTupRead) },
        { label: "Index scans", value: formatNumber(stats.idxScan) },
        { label: "Idx tuples fetched", value: formatNumber(stats.idxTupFetch) },
        { label: "Inserts", value: formatNumber(stats.nTupIns) },
        { label: "Updates", value: formatNumber(stats.nTupUpd) },
        { label: "Deletes", value: formatNumber(stats.nTupDel) },
        {
          label: "HOT updates",
          value: formatNumber(stats.nTupHotUpd),
          hint:
            stats.nTupUpd > 0
              ? `${Math.round((stats.nTupHotUpd / stats.nTupUpd) * 100)}% of updates`
              : undefined,
        },
      ],
    },
    {
      title: "Maintenance",
      items: [
        {
          label: "Last vacuum",
          value: formatRelative(lastVacuum),
          hint: lastVacuum
            ? `${stats.vacuumCount + stats.autovacuumCount} run${
                stats.vacuumCount + stats.autovacuumCount === 1 ? "" : "s"
              }`
            : "never",
        },
        {
          label: "Last analyze",
          value: formatRelative(lastAnalyze),
          hint: lastAnalyze
            ? `${stats.analyzeCount + stats.autoanalyzeCount} run${
                stats.analyzeCount + stats.autoanalyzeCount === 1 ? "" : "s"
              }`
            : "never",
        },
      ],
    },
    {
      title: "Schema",
      items: [
        {
          label: "Columns",
          value: columns ? formatNumber(columns.length) : "—",
        },
        {
          label: "Indexes",
          value: indexes ? formatNumber(indexes.length) : "—",
        },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            {section.title}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {section.items.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border/60 bg-card px-3 py-2.5"
              >
                <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground/80">
                  {item.label}
                </div>
                <div className="mt-1 text-[18px] font-mono text-foreground tabular-nums">
                  {item.value}
                </div>
                {item.hint ? (
                  <div className="text-[10.5px] font-mono text-muted-foreground mt-0.5">
                    {item.hint}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UnsupportedKind({
  title,
  hint,
  showStorageOnly,
  stats,
}: {
  title: string;
  hint: string;
  showStorageOnly?: boolean;
  stats?: TableStats;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <div className="text-[11.5px] font-mono text-muted-foreground mt-0.5">
          {hint}
        </div>
      </div>
      {showStorageOnly && stats ? (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Storage
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              ["Total size", formatBytes(stats.totalSize)],
              ["Table size", formatBytes(stats.tableSize)],
              ["Indexes size", formatBytes(stats.indexSize)],
              ["TOAST size", formatBytes(stats.toastSize)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-border/60 bg-card px-3 py-2.5"
              >
                <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground/80">
                  {label}
                </div>
                <div className="mt-1 text-[18px] font-mono text-foreground tabular-nums">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface ColumnFkLink {
  refSchema: string;
  refTable: string;
  refColumn: string;
}

function columnFkLinks(
  columnName: string,
  foreignKeys: ForeignKeyInfo[] | null,
): ColumnFkLink[] {
  if (!foreignKeys) return [];
  const out: ColumnFkLink[] = [];
  for (const fk of foreignKeys) {
    const idx = fk.columns.indexOf(columnName);
    if (idx >= 0 && fk.refColumns[idx]) {
      out.push({
        refSchema: fk.refSchema,
        refTable: fk.refTable,
        refColumn: fk.refColumns[idx],
      });
    }
  }
  return out;
}

