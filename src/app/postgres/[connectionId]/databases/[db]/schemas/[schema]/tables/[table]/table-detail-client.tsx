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
  FileCode,
  Wand2,
  Trash,
} from "lucide-react";
import { toast } from "sonner";
import { RowFormDialog, type ColumnInfo } from "./row-form-dialog";
import { DDLDialog } from "../../../../../../ddl-dialog";
import { DropConfirm, type DropTarget } from "../../../../../../drop-confirm";
import { ModifyTableDialog } from "../../../../../../modify-table-dialog";
import { cn } from "@/lib/utils";

interface IndexInfo {
  name: string;
  definition: string;
  isUnique: boolean;
  isPrimary: boolean;
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
  const [ddlOpen, setDdlOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
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
    if (tab === "indexes" && indexes === null) {
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
    } else if (tab === "data" && pageData === null) {
      loadData(0);
    }
  }, [tab, indexes, constraints, foreignKeys, pageData, fetchView, loadData]);

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
            onClick={() => setDdlOpen(true)}
            title="Show generated CREATE TABLE"
          >
            <FileCode className="size-3.5" />
            DDL
          </Button>
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

        <TabsContent value="structure" className="pt-4">
          {columns ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Nullable</TableHead>
                    <TableHead>Default</TableHead>
                    <TableHead>Key</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {columns.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono text-xs">
                        {c.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.dataType}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.isNullable ? "yes" : "no"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.default ?? "—"}
                      </TableCell>
                      <TableCell>
                        {c.isPrimaryKey ? (
                          <Badge variant="default" className="font-mono">
                            PK
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="indexes" className="pt-4">
          {indexes ? (
            indexes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No indexes.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Unique</TableHead>
                      <TableHead>Primary</TableHead>
                      <TableHead>Definition</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {indexes.map((i) => (
                      <TableRow key={i.name}>
                        <TableCell className="font-mono text-xs">
                          {i.name}
                        </TableCell>
                        <TableCell>
                          {i.isUnique ? (
                            <Badge variant="secondary">unique</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {i.isPrimary ? (
                            <Badge>primary</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground break-all">
                          {i.definition}
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

      <DDLDialog
        open={ddlOpen}
        onOpenChange={setDdlOpen}
        title={`${schema}.${table}`}
        description="generated CREATE TABLE"
        fetchUrl={`${base}?view=ddl`}
        payloadKey="ddl"
      />

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
