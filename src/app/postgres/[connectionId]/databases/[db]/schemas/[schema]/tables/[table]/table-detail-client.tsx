"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCcw,
  Pencil,
  Plus,
  Trash2,
  Search,
  Rows3,
  Rows4,
  Wand2,
  Trash,
  Copy,
  Check,
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
  const [ddlCopied, setDdlCopied] = useState(false);

  const [pageData, setPageData] = useState<TableData | null>(null);
  const [pageLimit] = useState(100);
  const [pageOffset, setPageOffset] = useState(0);
  const [loadingData, setLoadingData] = useState(false);

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
      const res = await fetch(`${base}?view=${view}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not load", { description: data.error });
        throw new Error(data.error);
      }
      return data;
    },
    [base]
  );

  const loadData = useCallback(
    async (offset: number) => {
      setLoadingData(true);
      try {
        const res = await fetch(
          `${base}?view=data&limit=${pageLimit}&offset=${offset}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (res.ok) setPageData(data as TableData);
        else toast.error("Could not load data", { description: data.error });
      } finally {
        setLoadingData(false);
      }
    },
    [base, pageLimit]
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
  }, [base]);

  useEffect(() => {
    if (columns === null) {
      fetchView("structure")
        .then((d) => setColumns((d as { columns: ColumnInfo[] }).columns))
        .catch(() => undefined);
    }
  }, [columns, fetchView]);

  useEffect(() => {
    if (tab === "structure" && columns && foreignKeys === null) {
      fetchView("foreign_keys")
        .then((d) =>
          setForeignKeys(
            (d as { foreignKeys: ForeignKeyInfo[] }).foreignKeys,
          ),
        )
        .catch(() => undefined);
    } else if (tab === "indexes" && indexes === null) {
      fetchView("indexes")
        .then((d) => setIndexes((d as { indexes: IndexInfo[] }).indexes))
        .catch(() => undefined);
    } else if (tab === "constraints" && constraints === null) {
      fetchView("constraints")
        .then((d) =>
          setConstraints(
            (d as { constraints: ConstraintInfo[] }).constraints
          )
        )
        .catch(() => undefined);
    } else if (tab === "foreign_keys" && foreignKeys === null) {
      fetchView("foreign_keys")
        .then((d) =>
          setForeignKeys(
            (d as { foreignKeys: ForeignKeyInfo[] }).foreignKeys
          )
        )
        .catch(() => undefined);
    } else if (tab === "ddl" && ddl === null) {
      fetch(`${base}?view=ddl`, { cache: "no-store" })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not load DDL");
          setDdl(data.ddl as string);
        })
        .catch((err) => {
          toast.error("Could not load DDL", {
            description: err instanceof Error ? err.message : String(err),
          });
        });
    } else if (tab === "stats" && stats === null) {
      fetch(`${base}?view=stats`, { cache: "no-store" })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not load stats");
          setStats(data.stats as TableStats);
        })
        .catch((err) => {
          toast.error("Could not load statistics", {
            description: err instanceof Error ? err.message : String(err),
          });
        });
    } else if (tab === "data" && pageData === null) {
      loadData(0);
    }
  }, [tab, columns, indexes, constraints, foreignKeys, ddl, stats, pageData, base, fetchView, loadData]);

  const totalPages = pageData?.totalRows
    ? Math.max(1, Math.ceil(pageData.totalRows / pageLimit))
    : null;
  const currentPage = Math.floor(pageOffset / pageLimit) + 1;

  const filteredRows = useMemo(() => {
    if (!pageData) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return pageData.rows;
    return pageData.rows.filter((row) =>
      row.some((cell) => {
        if (cell == null) return false;
        const text =
          typeof cell === "object" ? JSON.stringify(cell) : String(cell);
        return text.toLowerCase().includes(q);
      }),
    );
  }, [pageData, filter]);

  const cellPad = density === "compact" ? "px-3 py-1" : "px-3 py-2";
  const headPad = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";

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
          <div className="flex flex-wrap items-center gap-2 justify-between sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 -mx-1 px-1 py-1 rounded-md">
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter rows on this page…"
                  className="h-8 w-[260px] pl-7 text-xs font-mono"
                  spellCheck={false}
                />
              </div>
              <div className="inline-flex rounded-md border border-border/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDensity("compact")}
                  title="Compact rows"
                  className={cn(
                    "size-8 grid place-items-center transition-colors",
                    density === "compact"
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Rows4 className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDensity("normal")}
                  title="Normal rows"
                  className={cn(
                    "size-8 grid place-items-center transition-colors border-l border-border/60",
                    density === "normal"
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Rows3 className="size-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
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
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setInsertOpen(true)}
                disabled={!columns}
              >
                <Plus className="size-3.5" />
                Insert row
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => loadData(pageOffset)}
                disabled={loadingData}
              >
                {loadingData ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="size-3.5" />
                )}
                Refresh
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  const next = Math.max(0, pageOffset - pageLimit);
                  setPageOffset(next);
                  loadData(next);
                }}
                disabled={pageOffset === 0 || loadingData}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground font-mono">
                {currentPage}
                {totalPages ? `/${totalPages}` : ""}
              </span>
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  const next = pageOffset + pageLimit;
                  setPageOffset(next);
                  loadData(next);
                }}
                disabled={
                  loadingData ||
                  (pageData?.rowCount ?? 0) < pageLimit ||
                  (totalPages != null && currentPage >= totalPages)
                }
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
          {pageData ? (
            <div className="rounded-lg border border-border/60 overflow-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead className="bg-muted/60 sticky top-0 z-[1]">
                  <tr>
                    {pageData.fields.map((f) => {
                      const col = columns?.find((c) => c.name === f.name);
                      const isPk = !!col?.isPrimaryKey;
                      return (
                        <th
                          key={f.name}
                          className={cn(
                            "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                            headPad,
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            {isPk ? (
                              <span
                                className="size-1.5 rounded-full bg-brand"
                                title="Primary key"
                                aria-hidden
                              />
                            ) : null}
                            <span className="text-foreground">{f.name}</span>
                          </div>
                          <div className="text-[10px] font-normal text-muted-foreground">
                            {col?.dataType ?? f.dataType}
                            {col && !col.isNullable ? " · NOT NULL" : ""}
                          </div>
                        </th>
                      );
                    })}
                    <th className="w-px border-b border-border/60" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => (
                    <tr
                      key={i}
                      className="group border-b border-border/30 hover:bg-foreground/[0.025]"
                    >
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className={cn(
                            "max-w-[40ch] truncate align-top",
                            cellPad,
                          )}
                          title={cell == null ? "null" : String(cell)}
                        >
                          {cell === null ? (
                            <span className="text-muted-foreground/50 italic">
                              null
                            </span>
                          ) : typeof cell === "object" ? (
                            <span className="text-brand">
                              {JSON.stringify(cell)}
                            </span>
                          ) : typeof cell === "boolean" ? (
                            <span className="text-brand">
                              {cell ? "true" : "false"}
                            </span>
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1 align-top whitespace-nowrap">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={(pageData.fields.length || 1) + 1}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        {pageData.rows.length === 0
                          ? "No rows."
                          : `No rows match “${filter}”.`}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="structure" className="pt-4 space-y-3">
          {columns ? (
            <StructurePanel
              columns={columns}
              foreignKeys={foreignKeys}
              onModify={() => setModifyOpen(true)}
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
          {indexes ? (
            indexes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No indexes.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="text-right">Scans</TableHead>
                      <TableHead className="text-right">Tuples read</TableHead>
                      <TableHead>Definition</TableHead>
                      <TableHead className="w-px" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {indexes.map((i) => (
                      <TableRow
                        key={i.name}
                        className={cn(
                          "group",
                          i.unused && "bg-amber-500/5",
                        )}
                      >
                        <TableCell className="font-mono text-xs">
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
                        </TableCell>
                        <TableCell className="space-x-1">
                          {i.isPrimary ? <Badge>primary</Badge> : null}
                          {i.isUnique && !i.isPrimary ? (
                            <Badge variant="secondary">unique</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-right tabular-nums text-muted-foreground">
                          {formatBytes(i.sizeBytes)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "font-mono text-[11px] text-right tabular-nums",
                            i.scans === 0
                              ? "text-amber-600"
                              : "text-muted-foreground",
                          )}
                        >
                          {i.scans.toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-right tabular-nums text-muted-foreground">
                          {i.tuplesRead.toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground break-all">
                          {i.definition}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
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

        <TabsContent value="constraints" className="pt-4">
          {constraints ? (
            constraints.length === 0 ? (
              <p className="text-sm text-muted-foreground">No constraints.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Definition</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {constraints.map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="font-mono text-xs">
                          {c.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono">
                            {c.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground break-all">
                          {c.definition}
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

        <TabsContent value="foreign_keys" className="pt-4">
          {foreignKeys ? (
            foreignKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No foreign keys.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Columns</TableHead>
                      <TableHead>References</TableHead>
                      <TableHead>On update</TableHead>
                      <TableHead>On delete</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {foreignKeys.map((fk) => (
                      <TableRow key={fk.name}>
                        <TableCell className="font-mono text-xs">
                          {fk.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {fk.columns.join(", ")}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {fk.refSchema}.{fk.refTable} (
                          {fk.refColumns.join(", ")})
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {fk.onUpdate}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {fk.onDelete}
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
          {ddl === null ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="rounded-lg border border-border/60 bg-muted/30 relative">
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  generated CREATE TABLE
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={async () => {
                    if (!ddl) return;
                    try {
                      await navigator.clipboard.writeText(ddl);
                      setDdlCopied(true);
                      setTimeout(() => setDdlCopied(false), 1500);
                    } catch {
                      toast.error("Could not copy");
                    }
                  }}
                >
                  {ddlCopied ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {ddlCopied ? "Copied" : "Copy"}
                </Button>
              </div>
              <pre className="p-4 text-[12px] font-mono leading-[1.55] whitespace-pre overflow-x-auto max-h-[60vh] overflow-y-auto">
                {ddl}
              </pre>
            </div>
          )}
        </TabsContent>

        <TabsContent value="stats" className="pt-4">
          {stats ? (
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
          setColumns(null);
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

function StructurePanel({
  columns,
  foreignKeys,
  onModify,
}: {
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[] | null;
  onModify: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [density, setDensity] = useState<"compact" | "normal">("compact");

  const q = filter.trim().toLowerCase();
  const visible = q
    ? columns.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.dataType.toLowerCase().includes(q) ||
          (c.comment ?? "").toLowerCase().includes(q),
      )
    : columns;

  const cellPad = density === "compact" ? "px-3 py-1" : "px-3 py-2";
  const headPad = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";

  const pkCount = columns.filter((c) => c.isPrimaryKey).length;
  const notNullCount = columns.filter((c) => !c.isNullable).length;
  const withDefault = columns.filter((c) => c.default !== null).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, type, comment…"
              className="h-8 w-[260px] pl-7 text-xs font-mono"
              spellCheck={false}
            />
          </div>
          <div className="inline-flex rounded-md border border-border/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setDensity("compact")}
              title="Compact rows"
              className={cn(
                "size-8 grid place-items-center transition-colors",
                density === "compact"
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Rows4 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setDensity("normal")}
              title="Normal rows"
              className={cn(
                "size-8 grid place-items-center transition-colors border-l border-border/60",
                density === "normal"
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Rows3 className="size-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
            {columns.length} columns · {pkCount} pk · {notNullCount} not null ·{" "}
            {withDefault} with default
            {q ? ` · ${visible.length} match${visible.length === 1 ? "" : "es"}` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onModify}>
          <Wand2 className="size-3.5" />
          Modify columns
        </Button>
      </div>

      <div className="rounded-lg border border-border/60 overflow-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead className="bg-muted/60 sticky top-0 z-[1]">
            <tr>
              <th
                className={cn(
                  "text-right font-semibold border-b border-border/60 whitespace-nowrap w-10 text-muted-foreground",
                  headPad,
                )}
              >
                #
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Name
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Type
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Constraints
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Default
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Comment
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const fkLinks = columnFkLinks(c.name, foreignKeys);
              return (
                <tr
                  key={c.name}
                  className="border-b border-border/30 hover:bg-foreground/[0.025]"
                >
                  <td
                    className={cn(
                      "text-right text-muted-foreground tabular-nums align-top",
                      cellPad,
                    )}
                  >
                    {c.position}
                  </td>
                  <td className={cn("align-top", cellPad)}>
                    <div className="flex items-center gap-1.5">
                      {c.isPrimaryKey ? (
                        <span
                          className="size-1.5 rounded-full bg-brand shrink-0"
                          aria-label="primary key"
                          title="primary key"
                        />
                      ) : (
                        <span className="size-1.5 shrink-0" aria-hidden />
                      )}
                      <span className="text-foreground">{c.name}</span>
                    </div>
                  </td>
                  <td
                    className={cn(
                      "text-foreground/90 align-top whitespace-nowrap",
                      cellPad,
                    )}
                  >
                    {c.dataType}
                  </td>
                  <td className={cn("align-top", cellPad)}>
                    <div className="flex flex-wrap items-center gap-1">
                      {c.isPrimaryKey ? <Chip tone="brand">pk</Chip> : null}
                      {!c.isNullable ? <Chip tone="muted">not null</Chip> : null}
                      {c.isUnique ? <Chip tone="muted">unique</Chip> : null}
                      {fkLinks.map((fk, i) => (
                        <Chip key={i} tone="link">
                          → {fk.refSchema}.{fk.refTable}.{fk.refColumn}
                        </Chip>
                      ))}
                      {c.isNullable &&
                      !c.isPrimaryKey &&
                      !c.isUnique &&
                      fkLinks.length === 0 ? (
                        <span className="text-muted-foreground/50 italic">
                          —
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td
                    className={cn(
                      "text-muted-foreground align-top max-w-[28ch] truncate",
                      cellPad,
                    )}
                    title={c.default ?? undefined}
                  >
                    {c.default ?? (
                      <span className="text-muted-foreground/50 italic">—</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "text-muted-foreground align-top max-w-[40ch] truncate",
                      cellPad,
                    )}
                    title={c.comment ?? undefined}
                  >
                    {c.comment ?? (
                      <span className="text-muted-foreground/40 italic">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No columns match “{filter}”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "brand" | "muted" | "link";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-px rounded border text-[10px] uppercase tracking-wider whitespace-nowrap",
        tone === "brand" && "bg-brand/15 text-brand border-brand/40",
        tone === "muted" && "bg-foreground/5 text-foreground/80 border-border",
        tone === "link" &&
          "bg-foreground/5 text-foreground/80 border-border normal-case tracking-normal text-[10.5px]",
      )}
    >
      {children}
    </span>
  );
}
