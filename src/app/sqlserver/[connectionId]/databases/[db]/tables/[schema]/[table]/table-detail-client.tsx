"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Copy, Check, Plus } from "lucide-react";
import { RowFormDialog, type ColumnInfo as RowColumnInfo } from "./row-form-dialog";

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
function fmtCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined)
    return <span className="text-muted-foreground/40">NULL</span>;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const PAGE = 100;

export function TableDetailClient({ connectionId, database, schema, table }: Props) {
  const base = `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;
  const [tab, setTab] = useState("data");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [data, setData] = useState<TableData | null>(null);
  const [offset, setOffset] = useState(0);
  const [copied, setCopied] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);

  const rowColumns: RowColumnInfo[] = (detail?.columns ?? []).map((c) => ({
    name: c.name,
    dataType: c.dataType,
    nullable: c.nullable,
    isIdentity: c.isIdentity,
    defaultDefinition: c.defaultDefinition,
    isPrimaryKey: c.isPrimaryKey,
  }));

  const loadDetail = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    const d = await res.json();
    if (res.ok) setDetail(d as Detail);
    else toast.error("Could not load table", { description: d.error });
  }, [base]);

  const loadData = useCallback(
    async (off: number) => {
      const res = await fetch(`${base}/data?offset=${off}&limit=${PAGE}`, {
        cache: "no-store",
      });
      const d = await res.json();
      if (res.ok) setData(d as TableData);
      else toast.error("Could not load data", { description: d.error });
    },
    [base],
  );

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);
  useEffect(() => {
    if (tab === "data" && !data) void loadData(0);
  }, [tab, data, loadData]);

  const ddl = detail ? buildClientDdl(detail) : "";

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
        <Link
          href={`/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Link>
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
          {!data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="rounded-lg border border-border/60 overflow-auto flex-1 min-h-0">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      {data.fields.map((f, i) => (
                        <th key={i} className="px-3 py-1.5 text-left font-semibold whitespace-nowrap">
                          {f}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-border/30 hover:bg-muted/30">
                        {row.map((c, ci) => (
                          <td key={ci} className="px-3 py-1 align-top max-w-[40ch] truncate">
                            {fmtCell(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                <span>
                  {offset + 1}–{Math.min(offset + PAGE, data.total)} of{" "}
                  {data.total.toLocaleString()}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={offset === 0}
                    onClick={() => {
                      const o = Math.max(0, offset - PAGE);
                      setOffset(o);
                      void loadData(o);
                    }}
                  >
                    Prev
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={offset + PAGE >= data.total}
                    onClick={() => {
                      const o = offset + PAGE;
                      setOffset(o);
                      void loadData(o);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* STRUCTURE */}
        <TabsContent value="structure" className="pt-4">
          {!detail ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Nullable</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead>Default</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.columns.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {c.name}
                          {c.isPrimaryKey ? <Badge>PK</Badge> : null}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.dataType}
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.nullable ? "NULL" : "NOT NULL"}
                      </TableCell>
                      <TableCell className="space-x-1">
                        {c.isIdentity ? (
                          <Badge variant="secondary">
                            IDENTITY({c.identitySeed},{c.identityIncrement})
                          </Badge>
                        ) : null}
                        {c.isComputed ? (
                          <Badge variant="secondary">computed</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {c.isComputed
                          ? c.computedDefinition
                          : c.defaultDefinition ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* INDEXES */}
        <TabsContent value="indexes" className="pt-4">
          {!detail ? (
            <Skeleton className="h-40 w-full" />
          ) : detail.indexes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No indexes.</p>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Key columns</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Seeks/Scans</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.indexes.map((i) => (
                    <TableRow key={i.name} className={cn(i.unused && "bg-amber-500/5")}>
                      <TableCell className="font-mono text-xs">
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
                      </TableCell>
                      <TableCell className="text-[11px] font-mono text-muted-foreground">
                        {i.typeDesc}
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {i.keyColumns.join(", ")}
                        {i.includedColumns.length > 0 ? (
                          <span className="text-muted-foreground/60">
                            {" "}
                            INCLUDE ({i.includedColumns.join(", ")})
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                        {fmtBytes(i.sizeBytes)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-[11px] tabular-nums",
                          i.userSeeks + i.userScans === 0
                            ? "text-amber-600"
                            : "text-muted-foreground",
                        )}
                      >
                        {(i.userSeeks + i.userScans + i.userLookups).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* CONSTRAINTS */}
        <TabsContent value="constraints" className="pt-4">
          {!detail ? (
            <Skeleton className="h-40 w-full" />
          ) : detail.constraints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No check/default constraints.</p>
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
                  {detail.constraints.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono text-xs">{c.name}</TableCell>
                      <TableCell className="text-xs">{c.type}</TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground break-all">
                        {c.definition}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* FOREIGN KEYS */}
        <TabsContent value="foreign_keys" className="pt-4">
          {!detail ? (
            <Skeleton className="h-40 w-full" />
          ) : detail.foreignKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No foreign keys.</p>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Columns</TableHead>
                    <TableHead>References</TableHead>
                    <TableHead>On update / delete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.foreignKeys.map((f) => (
                    <TableRow key={f.name}>
                      <TableCell className="font-mono text-xs">{f.name}</TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {f.columns.join(", ")}
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {f.refSchema}.{f.refTable} ({f.refColumns.join(", ")})
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {f.onUpdate} / {f.onDelete}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* DDL */}
        <TabsContent value="ddl" className="pt-4">
          {!detail ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="relative">
              <Button
                size="xs"
                variant="outline"
                className="absolute top-2 right-2 gap-1"
                onClick={async () => {
                  await navigator.clipboard.writeText(ddl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "copied" : "copy"}
              </Button>
              <pre className="rounded-md border border-border/60 bg-zinc-950 text-zinc-100 p-4 text-xs font-mono whitespace-pre-wrap break-words overflow-auto max-h-[60vh]">
                {ddl}
              </pre>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {detail ? (
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
