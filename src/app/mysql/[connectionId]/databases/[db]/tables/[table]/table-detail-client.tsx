"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { ErrorState } from "@/components/workspace/error-state";
import { RefreshButton } from "@/components/workspace/auto-refresh";
import { DataPagination } from "@/components/sql/pagination";
import { StructurePanel } from "@/components/workspace/sql/structure-panel";
import { DdlPanel } from "@/components/workspace/sql/ddl-panel";
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
  Trash,
  Download,
  Eraser,
  SquareTerminal,
} from "lucide-react";
import { toast } from "sonner";
import {
  RowFormDialog,
  type ColumnInfo,
  type ColumnValue,
} from "./row-form-dialog";
import { CreateIndexDialog } from "./create-index-dialog";
import {
  rowsToCSV,
  rowsToJSON,
  downloadText,
} from "@/lib/sql/result-export";

interface IndexInfo {
  name: string;
  unique: boolean;
  primary: boolean;
  type: string;
  columns: string[];
}

interface TableMeta {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  ddl: string;
  primaryKey: string[];
}

interface TableData {
  columns: string[];
  rows: Record<string, ColumnValue>[];
  totalRows: number;
  primaryKey: string[];
}

interface Props {
  connectionId: string;
  db: string;
  table: string;
}

type SortState = { column: string; dir: "asc" | "desc" } | null;

export function TableDetailClient({ connectionId, db, table }: Props) {
  const base = `/api/mysql/${connectionId}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`;

  const [tab, setTab] = useState("data");

  const [meta, setMeta] = useState<TableMeta | null>(null);

  const [pageData, setPageData] = useState<TableData | null>(null);
  const [pageLimit, setPageLimit] = useState(100);
  const [pageOffset, setPageOffset] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [loadingData, setLoadingData] = useState(false);

  type ViewKey = "data" | "meta";
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
  const [editTarget, setEditTarget] = useState<Record<string, ColumnValue> | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<Record<
    string,
    ColumnValue
  > | null>(null);
  const [deleting, setDeleting] = useState(false);

  // DataGrip-style affordances
  const [filter, setFilter] = useState("");
  const [density, setDensity] = useState<"compact" | "normal">("compact");
  const [dropOpen, setDropOpen] = useState(false);
  const [truncateOpen, setTruncateOpen] = useState(false);
  const [tableWorking, setTableWorking] = useState(false);
  const [createIndexOpen, setCreateIndexOpen] = useState(false);
  const [dropIdxTarget, setDropIdxTarget] = useState<string | null>(null);
  const [idxWorking, setIdxWorking] = useState(false);

  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const columns = meta?.columns ?? null;
  const indexes = meta?.indexes ?? null;
  const primaryKey = meta?.primaryKey ?? [];

  const loadMeta = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(base, { cache: "no-store", signal: ac.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setMeta(data as TableMeta);
      clearError("meta");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrors((prev) => ({
          ...prev,
          meta: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  }, [base, clearError]);

  const loadData = useCallback(
    async (
      offset: number,
      limit: number = pageLimit,
      sortState: SortState = sort
    ) => {
      setLoadingData(true);
      try {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        if (sortState) {
          params.set("orderBy", sortState.column);
          params.set("orderDir", sortState.dir);
        }
        const res = await fetch(`${base}/rows?${params.toString()}`, {
          cache: "no-store",
        });
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
    [base, pageLimit, sort, clearError]
  );

  // Reset on table change.
  useEffect(() => {
    setMeta(null);
    setPageData(null);
    setPageOffset(0);
    setSort(null);
    // Functional form so this bails out (same reference) when errors is
    // already empty — otherwise this always-runs-on-mount effect hands the
    // lazy-load effects below a brand-new object every time, since they list
    // `errors` in their dependency arrays, and that spurious "change" makes
    // them re-fire once immediately after mount, before the first fetch
    // settles (a double fetch).
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [base]);

  // Meta is needed by every tab (PK badges, column lists) — load eagerly.
  useEffect(() => {
    if (meta === null && !errors.meta) loadMeta();
  }, [meta, loadMeta, errors.meta]);

  useEffect(() => {
    if (tab === "data" && pageData === null && !errors.data) loadData(pageOffset);
  }, [tab, pageData, loadData, errors.data, pageOffset]);

  const toggleSort = (column: string) => {
    setSort((prev) => {
      let next: SortState;
      if (!prev || prev.column !== column) next = { column, dir: "asc" };
      else if (prev.dir === "asc") next = { column, dir: "desc" };
      else next = null;
      setPageOffset(0);
      loadData(0, pageLimit, next);
      return next;
    });
  };

  const gridColumns: GridColumn[] = (pageData?.columns ?? []).map((name) => {
    const col = columns?.find((c) => c.name === name);
    return {
      name,
      hint: `${col?.columnType ?? ""}${col && !col.nullable ? " · NOT NULL" : ""}`,
      isPrimaryKey: !!col?.isPrimaryKey,
    };
  });

  // Filter the row *objects* first, keeping them alongside the derived
  // tuples DataGrid renders — rowActions (setEditTarget/setDeleteTarget)
  // needs the original object, and indexing into the unfiltered array by
  // position would point at the wrong row once filtering removes any.
  const filteredObjects = useMemo(() => {
    if (!pageData) return [];
    return pageData.rows.filter(
      (r) =>
        filterRows([pageData.columns.map((c) => r[c] ?? null)], filter)
          .length > 0,
    );
  }, [pageData, filter]);

  const filteredGridRows: unknown[][] = useMemo(
    () =>
      filteredObjects.map((r) =>
        (pageData?.columns ?? []).map((c) => r[c] ?? null),
      ),
    [filteredObjects, pageData],
  );

  const canMutateRows = primaryKey.length > 0;
  const noPkReason = "no primary key — read only";

  const exportRows = (format: "csv" | "json") => {
    if (!pageData) return;
    const fields = pageData.columns;
    const tuples = filteredGridRows;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "csv") {
      downloadText(
        `${table}-${stamp}.csv`,
        rowsToCSV(fields, tuples),
        "text/csv"
      );
    } else {
      downloadText(
        `${table}-${stamp}.json`,
        rowsToJSON(fields, tuples),
        "application/json"
      );
    }
  };

  const performDelete = async () => {
    if (!deleteTarget || primaryKey.length === 0) return;
    const pk = Object.fromEntries(
      primaryKey.map((c) => [c, deleteTarget[c] ?? null])
    );
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

  const performTruncate = async () => {
    setTableWorking(true);
    try {
      const res = await fetch(`${base}?action=truncate`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Table truncated");
        setTruncateOpen(false);
        loadData(0);
      } else {
        toast.error("Truncate failed", { description: data.error });
      }
    } finally {
      setTableWorking(false);
    }
  };

  const performDrop = async () => {
    setTableWorking(true);
    try {
      const res = await fetch(`${base}?kind=table`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Table dropped");
        setDropOpen(false);
        router.push(
          `/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query`
        );
      } else {
        toast.error("Drop failed", { description: data.error });
        setTableWorking(false);
      }
    } catch {
      setTableWorking(false);
    }
  };

  const performDropIndex = async () => {
    if (!dropIdxTarget) return;
    setIdxWorking(true);
    try {
      const res = await fetch(
        `${base}/indexes/${encodeURIComponent(dropIdxTarget)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error("Drop failed", { description: data.error });
      } else {
        toast.success("Index dropped");
        setDropIdxTarget(null);
        loadMeta();
      }
    } finally {
      setIdxWorking(false);
    }
  };

  const sqlColumns: SqlColumn[] = (columns ?? []).map((c) => ({
    name: c.name,
    position: c.ordinal,
    dataType: c.columnType,
    nullable: c.nullable,
    default: c.default,
    isPrimaryKey: c.isPrimaryKey,
    comment: c.comment || null,
    extra: c.extra || null,
  }));

  return (
    <WorkspacePage
      title={<span className="font-mono">{table}</span>}
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
            nativeButton={false}
            render={
              <a
                href={`/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query`}
              />
            }
            title="Open a SQL query editor for this database"
          >
            <SquareTerminal className="size-3.5" />
            Open query
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTruncateOpen(true)}
            disabled={!meta}
            title="Delete all rows (TRUNCATE)"
          >
            <Eraser className="size-3.5" />
            Truncate
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
          <TabsTrigger value="ddl">DDL</TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="pt-4 space-y-3">
          <GridToolbar
            filter={filter}
            onFilterChange={setFilter}
            density={density}
            onDensityChange={setDensity}
            status={
              <>
                {pageData
                  ? `${pageData.totalRows.toLocaleString()} rows`
                  : "…"}
                {pageData?.rows.length
                  ? ` · ${pageOffset + 1}–${pageOffset + pageData.rows.length}`
                  : ""}
                {filter.trim()
                  ? ` · ${filteredGridRows.length} match${filteredGridRows.length === 1 ? "" : "es"}`
                  : ""}
              </>
            }
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="outline" disabled={!pageData}>
                    <Download className="size-3.5" />
                    Export
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportRows("csv")}>
                  Export page as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportRows("json")}>
                  Export page as JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              {errors.meta ? (
                <ErrorState
                  title="Could not load column metadata"
                  message={errors.meta}
                  onRetry={() => {
                    clearError("meta");
                    setMeta(null);
                  }}
                  className="px-3 py-2 mb-3"
                />
              ) : null}
              <DataGrid
                columns={gridColumns}
                rows={filteredGridRows}
                density={density}
                sort={sort}
                onToggleSort={toggleSort}
                rowActions={(_row, i) => (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={!canMutateRows}
                      title={canMutateRows ? "Edit row" : noPkReason}
                      onClick={() => setEditTarget(filteredObjects[i])}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-destructive hover:text-destructive"
                      disabled={!canMutateRows}
                      title={canMutateRows ? "Delete row" : noPkReason}
                      onClick={() => setDeleteTarget(filteredObjects[i])}
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
              total={pageData.totalRows}
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
          {errors.meta ? (
            <ErrorState
              title="Could not load structure"
              message={errors.meta}
              onRetry={() => {
                clearError("meta");
                setMeta(null);
              }}
            />
          ) : columns ? (
            <StructurePanel columns={sqlColumns} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="indexes" className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground font-mono">
              {indexes
                ? `${indexes.length} index${indexes.length === 1 ? "" : "es"}`
                : "…"}
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
          {errors.meta ? (
            <ErrorState
              title="Could not load indexes"
              message={errors.meta}
              onRetry={() => {
                clearError("meta");
                setMeta(null);
              }}
            />
          ) : indexes ? (
            indexes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No indexes.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Columns</TableHead>
                      <TableHead className="w-px" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {indexes.map((i) => (
                      <TableRow key={i.name} className="group">
                        <TableCell className="font-mono text-xs">
                          {i.name}
                        </TableCell>
                        <TableCell className="space-x-1">
                          {i.primary ? <Badge>primary</Badge> : null}
                          {i.unique && !i.primary ? (
                            <Badge variant="secondary">unique</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {i.type}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground break-all">
                          {i.columns.join(", ")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 text-destructive hover:text-destructive"
                              disabled={i.primary}
                              title={
                                i.primary
                                  ? "Primary key index can't be dropped here"
                                  : "Drop index"
                              }
                              onClick={() => setDropIdxTarget(i.name)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="ddl" className="pt-4">
          {errors.meta ? (
            <ErrorState
              title="Could not load DDL"
              message={errors.meta}
              onRetry={() => {
                clearError("meta");
                setMeta(null);
              }}
            />
          ) : meta === null ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <DdlPanel label="SHOW CREATE TABLE" ddl={meta.ddl} />
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
            db={db}
            table={table}
            columns={columns}
            primaryKey={primaryKey}
            onSuccess={() => loadData(pageOffset)}
          />
          <RowFormDialog
            open={editTarget !== null}
            onOpenChange={(v) => {
              if (!v) setEditTarget(null);
            }}
            mode="edit"
            base={base}
            db={db}
            table={table}
            columns={columns}
            primaryKey={primaryKey}
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
        table={table}
        availableColumns={columns?.map((c) => c.name) ?? []}
        onCreated={() => {
          loadMeta();
          if (tab !== "indexes") setTab("indexes");
        }}
      />

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
                ALTER TABLE {table} DROP INDEX {dropIdxTarget}
              </span>
              . This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={idxWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                performDropIndex();
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

      <AlertDialog
        open={truncateOpen}
        onOpenChange={(v) => {
          if (!v && !tableWorking) setTruncateOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Truncate table?</AlertDialogTitle>
            <AlertDialogDescription>
              This will run{" "}
              <span className="font-mono">TRUNCATE TABLE {table}</span> and
              delete <strong>every row</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={tableWorking}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                performTruncate();
              }}
              disabled={tableWorking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tableWorking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Truncate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dropOpen}
        onOpenChange={(v) => {
          if (!v && !tableWorking) setDropOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop table?</AlertDialogTitle>
            <AlertDialogDescription>
              This will run{" "}
              <span className="font-mono">DROP TABLE {table}</span> and remove
              the table and all its data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={tableWorking}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                performDrop();
              }}
              disabled={tableWorking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tableWorking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Drop table
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              <span className="font-mono">DELETE FROM {table}</span> for the
              selected row. This cannot be undone.
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
