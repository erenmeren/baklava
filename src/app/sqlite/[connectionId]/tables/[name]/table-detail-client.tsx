"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, Copy, RefreshCcw } from "lucide-react";

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  pk: number;
  defaultValue: string | null;
}

interface IndexInfo {
  name: string;
  unique: boolean;
  partial: boolean;
}

interface TableDetail {
  table: {
    name: string;
    rowCount: number;
    system: boolean;
    ddl: string;
  };
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  data: {
    columns: string[];
    rows: unknown[][];
  };
}

interface Props {
  connectionId: string;
  tableName: string;
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

export function TableDetailClient({ connectionId, tableName }: Props) {
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [tab, setTab] = useState("columns");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/sqlite/${connectionId}/tables/${encodeURIComponent(tableName)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setDetail(data as TableDetail);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, tableName]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh every 15s (matches overview pages).
  useEffect(() => {
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <WorkspacePage
      title={<span className="font-mono">{tableName}</span>}
      description={
        detail ? (
          <span className="inline-flex items-center gap-3">
            <span>
              {formatCompact(detail.table.rowCount)} row
              {detail.table.rowCount === 1 ? "" : "s"} ·{" "}
              {detail.columns.length} column
              {detail.columns.length === 1 ? "" : "s"}
            </span>
            {detail.table.system ? (
              <Badge
                variant="secondary"
                className="text-[9px] font-mono uppercase tracking-wider"
              >
                system
              </Badge>
            ) : null}
          </span>
        ) : undefined
      }
      actions={
        <>
          <Link
            href={`/sqlite/${connectionId}/tables`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="ddl">DDL</TabsTrigger>
          <TabsTrigger value="indexes">
            Indexes
            {detail && detail.indexes.length > 0 ? (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {detail.indexes.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="columns" className="pt-4">
          {detail ? (
            <ColumnsView columns={detail.columns} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="data" className="pt-4">
          {detail ? (
            <DataView data={detail.data} rowCount={detail.table.rowCount} />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </TabsContent>

        <TabsContent value="ddl" className="pt-4">
          {detail ? (
            <DdlView ddl={detail.table.ddl} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="indexes" className="pt-4">
          {detail ? (
            <IndexesView indexes={detail.indexes} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Columns tab
// ──────────────────────────────────────────────────────────────────────────────

function ColumnsView({ columns }: { columns: ColumnInfo[] }) {
  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        This table has no columns.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/30">
          <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <th className="px-3 py-2 text-left">Column</th>
            <th className="px-3 py-2 text-left w-[20%]">Type</th>
            <th className="px-3 py-2 text-left w-[160px]">Constraints</th>
            <th className="px-3 py-2 text-left w-[25%]">Default</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name} className="border-t border-border/40 hover:bg-muted/30">
              <td className="px-3 py-2 align-middle font-mono">{c.name}</td>
              <td className="px-3 py-2 align-middle">
                {c.type ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono normal-case tracking-normal border-border/60"
                  >
                    {c.type}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </td>
              <td className="px-3 py-2 align-middle">
                <div className="flex items-center gap-1 flex-wrap">
                  {c.pk > 0 ? (
                    <Badge
                      variant="outline"
                      className="text-[9px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400 border-amber-500/40"
                    >
                      PK{c.pk > 1 ? ` ${c.pk}` : ""}
                    </Badge>
                  ) : null}
                  {c.notNull ? (
                    <Badge
                      variant="outline"
                      className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-border/60"
                    >
                      not null
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2 align-middle font-mono text-muted-foreground">
                {c.defaultValue == null ? (
                  <span className="text-muted-foreground/50">—</span>
                ) : (
                  c.defaultValue
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Data tab
// ──────────────────────────────────────────────────────────────────────────────

function DataView({
  data,
  rowCount,
}: {
  data: { columns: string[]; rows: unknown[][] };
  rowCount: number;
}) {
  if (data.columns.length === 0 || data.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        No rows in this table.
      </div>
    );
  }
  const shown = Math.min(100, data.rows.length);
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        Showing first {shown.toLocaleString()} of {rowCount.toLocaleString()} row
        {rowCount === 1 ? "" : "s"}
      </p>
      <div className="rounded-lg border border-border/60 overflow-auto max-h-[70vh]">
        <table className="text-xs font-mono">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {data.columns.map((c) => (
                <th
                  key={c}
                  className="px-3 py-2 text-left font-semibold whitespace-nowrap border-r border-border/40 last:border-r-0"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr
                key={i}
                className="border-t border-border/30 hover:bg-muted/30"
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="px-3 py-1.5 align-top border-r border-border/30 last:border-r-0 max-w-[40ch]"
                  >
                    {cell === null || cell === undefined ? (
                      <span className="text-muted-foreground/60 italic">null</span>
                    ) : (
                      <span className="block truncate" title={renderCell(cell)}>
                        {renderCell(cell)}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// DDL tab
// ──────────────────────────────────────────────────────────────────────────────

function DdlView({ ddl }: { ddl: string }) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => (ddl ? ddl.trim() : ""), [ddl]);
  const onCopy = async () => {
    if (!pretty) return;
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };
  if (!pretty) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        No CREATE statement recorded for this table.
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          CREATE statement
        </p>
        <Button size="xs" variant="ghost" onClick={onCopy} className="h-6 px-2">
          {copied ? (
            <Check className="size-3" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? "copied" : "copy"}
        </Button>
      </div>
      <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
        {pretty}
      </pre>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Indexes tab
// ──────────────────────────────────────────────────────────────────────────────

function IndexesView({ indexes }: { indexes: IndexInfo[] }) {
  if (indexes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        No indexes on this table.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/30">
          <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <th className="px-3 py-2 text-left">Index</th>
            <th className="px-3 py-2 text-left w-[180px]">Flags</th>
          </tr>
        </thead>
        <tbody>
          {indexes.map((i) => (
            <tr key={i.name} className="border-t border-border/40 hover:bg-muted/30">
              <td className="px-3 py-2 align-middle font-mono">{i.name}</td>
              <td className="px-3 py-2 align-middle">
                <div className="flex items-center gap-1 flex-wrap">
                  {i.unique ? (
                    <Badge
                      variant="outline"
                      className="text-[9px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border-emerald-500/40"
                    >
                      unique
                    </Badge>
                  ) : null}
                  {i.partial ? (
                    <Badge
                      variant="outline"
                      className="text-[9px] font-mono uppercase tracking-wider text-blue-700 dark:text-blue-400 border-blue-500/40"
                    >
                      partial
                    </Badge>
                  ) : null}
                  {!i.unique && !i.partial ? (
                    <span className="text-muted-foreground/50 text-xs">—</span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
