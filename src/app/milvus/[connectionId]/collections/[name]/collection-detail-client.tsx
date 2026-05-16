"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { DetailBlock } from "@/components/data/detail-block";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  RefreshCcw,
} from "lucide-react";

interface MilvusField {
  name: string;
  dataType: string;
  isPrimary: boolean;
  autoId: boolean;
  isPartitionKey: boolean;
  nullable: boolean;
  description: string;
  dimension: number | null;
  maxLength: number | null;
  elementType: string | null;
}

interface MilvusIndex {
  fieldName: string;
  indexName: string;
  indexType: string;
  metricType: string;
  params: Record<string, string>;
}

interface CollectionDetail {
  name: string;
  id: string;
  description: string;
  autoId: boolean;
  enableDynamicField: boolean;
  consistencyLevel: string;
  loaded: boolean;
  loadState: string;
  fields: MilvusField[];
  stats: { key: string; value: string }[];
  indexes: MilvusIndex[];
}

interface SampleRow {
  display: Record<string, unknown>;
  vectors: Record<
    string,
    { dim: number; head: number[]; tail: number[] }
  >;
}

interface Props {
  connectionId: string;
  collectionName: string;
}

export function CollectionDetailClient({
  connectionId,
  collectionName,
}: Props) {
  const base = `/api/milvus/${connectionId}/collections/${encodeURIComponent(collectionName)}`;

  const [tab, setTab] = useState("schema");
  const [detail, setDetail] = useState<CollectionDetail | null>(null);

  const [sample, setSample] = useState<SampleRow[] | null>(null);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [sampleNotLoaded, setSampleNotLoaded] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<SampleRow | null>(null);

  const loadDetail = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setDetail(data.collection as CollectionDetail);
    else toast.error("Could not load collection", { description: data.error });
  }, [base]);

  const loadSample = useCallback(async () => {
    setSampleLoading(true);
    setSampleNote(null);
    setSampleNotLoaded(false);
    try {
      const res = await fetch(`${base}/sample?limit=50`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setSample(data.items as SampleRow[]);
        if (data.note) setSampleNote(data.note);
        if (data.notLoaded) setSampleNotLoaded(true);
      } else {
        toast.error("Could not load sample", { description: data.error });
      }
    } finally {
      setSampleLoading(false);
    }
  }, [base]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (tab === "sample" && sample === null && !sampleLoading) {
      loadSample();
    }
  }, [tab, sample, sampleLoading, loadSample]);

  const rowCountStat =
    detail?.stats.find((s) => s.key === "row_count")?.value ?? "0";

  return (
    <WorkspacePage
      title={<span className="font-mono">{collectionName}</span>}
      description={
        detail
          ? `${detail.fields.length} field${detail.fields.length === 1 ? "" : "s"} · ${Number(rowCountStat).toLocaleString()} rows · ${detail.loaded ? "loaded" : "unloaded"}`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/milvus/${connectionId}/collections`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              loadDetail();
              if (tab === "sample") loadSample();
            }}
          >
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="sample">Sample</TabsTrigger>
          <TabsTrigger value="indexes">
            Indexes
            {detail && detail.indexes.length > 0 ? (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {detail.indexes.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
        </TabsList>

        <TabsContent value="schema" className="pt-4">
          {detail ? (
            <SchemaTab detail={detail} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="sample" className="pt-4 space-y-3">
          {sampleNotLoaded ? (
            <NotLoadedNotice note={sampleNote} />
          ) : sampleLoading ? (
            <p className="text-sm text-muted-foreground">Querying…</p>
          ) : sample === null ? (
            <Skeleton className="h-32 w-full" />
          ) : sample.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {sampleNote ?? "No rows."}
            </p>
          ) : (
            <SampleTable
              rows={sample}
              fields={detail?.fields ?? []}
              onSelect={setSelectedRow}
            />
          )}
        </TabsContent>

        <TabsContent value="indexes" className="pt-4">
          {detail ? <IndexesTab indexes={detail.indexes} /> : null}
        </TabsContent>

        <TabsContent value="stats" className="pt-4">
          {detail ? <StatsTab stats={detail.stats} detail={detail} /> : null}
        </TabsContent>
      </Tabs>

      <SampleRowSheet
        row={selectedRow}
        collectionName={collectionName}
        onClose={() => setSelectedRow(null)}
      />
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema tab
// ─────────────────────────────────────────────────────────────────────────────

function fieldTypeClass(type: string): string {
  if (type.endsWith("Vector"))
    return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30";
  if (type === "VarChar" || type === "String")
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (type === "JSON")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
  return "bg-muted/50 text-foreground/80 border-border/60";
}

function SchemaTab({ detail }: { detail: CollectionDetail }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Meta label="Collection ID" value={detail.id || "—"} mono />
        <Meta label="Consistency" value={detail.consistencyLevel || "—"} />
        <Meta label="Auto ID" value={detail.autoId ? "yes" : "no"} />
        <Meta
          label="Dynamic field"
          value={detail.enableDynamicField ? "enabled" : "disabled"}
        />
      </div>
      {detail.description ? (
        <p className="text-xs text-muted-foreground italic">
          {detail.description}
        </p>
      ) : null}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-[80px]">Dim</TableHead>
              <TableHead className="w-[110px]">Flags</TableHead>
              <TableHead className="w-[100px]">Max length</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.fields.map((f) => (
              <TableRow key={f.name}>
                <TableCell className="font-mono text-xs">
                  <div className="flex items-center gap-1.5">
                    {f.name}
                    {f.isPrimary ? (
                      <Badge
                        variant="secondary"
                        className="text-[9px] font-mono uppercase tracking-wider bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30"
                      >
                        PK
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono",
                      fieldTypeClass(f.dataType)
                    )}
                  >
                    {f.dataType}
                    {f.elementType ? `<${f.elementType}>` : ""}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {f.dimension ?? (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {f.autoId ? (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-mono uppercase tracking-wider"
                      >
                        auto
                      </Badge>
                    ) : null}
                    {f.isPartitionKey ? (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-mono uppercase tracking-wider"
                      >
                        part
                      </Badge>
                    ) : null}
                    {f.nullable ? (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-mono uppercase tracking-wider"
                      >
                        null
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {f.maxLength ?? (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {f.description || (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample tab
// ─────────────────────────────────────────────────────────────────────────────

function NotLoadedNotice({ note }: { note: string | null }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6 flex items-start gap-3">
      <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          Collection is not loaded into memory
        </p>
        <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
          {note ??
            "Load the collection via the Milvus client or admin tool before browsing rows. Baklava does not auto-load — it's a memory-intensive operation."}
        </p>
        <p className="text-[10px] font-mono uppercase tracking-wider text-amber-700/60 dark:text-amber-300/60 pt-1">
          milvus_client.load_collection(&quot;name&quot;)
        </p>
      </div>
    </div>
  );
}

function shortRender(value: unknown, max = 60): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    return value.length > max ? value.slice(0, max) + "…" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const s = JSON.stringify(value);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(value);
  }
}

function SampleTable({
  rows,
  fields,
  onSelect,
}: {
  rows: SampleRow[];
  fields: MilvusField[];
  onSelect: (row: SampleRow) => void;
}) {
  // Determine column order: PK first, then scalar fields, vectors last.
  const allKeys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.display)) allKeys.add(k);
  }
  const orderedFields = [...fields].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    const aVec = a.dataType.endsWith("Vector");
    const bVec = b.dataType.endsWith("Vector");
    if (aVec && !bVec) return 1;
    if (!aVec && bVec) return -1;
    return a.name.localeCompare(b.name);
  });
  const cols = orderedFields
    .map((f) => f.name)
    .filter((name) => allKeys.has(name));
  // include dynamic fields not in schema, at the end
  for (const k of allKeys) if (!cols.includes(k)) cols.push(k);

  return (
    <div className="rounded-lg border border-border/60 overflow-auto max-h-[60vh]">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0 z-10">
          <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {cols.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left font-semibold whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              onClick={() => onSelect(r)}
              className="border-t border-border/30 cursor-pointer hover:bg-muted/40 transition-colors"
            >
              {cols.map((c) => {
                const v = r.display[c];
                const isVector = c in r.vectors;
                return (
                  <td
                    key={c}
                    className={cn(
                      "px-3 py-1.5 align-top font-mono",
                      isVector
                        ? "text-indigo-700 dark:text-indigo-300"
                        : "text-foreground/80"
                    )}
                  >
                    {shortRender(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SampleRowSheet({
  row,
  collectionName,
  onClose,
}: {
  row: SampleRow | null;
  collectionName: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={Boolean(row)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-base font-mono">
            {collectionName}
          </SheetTitle>
        </SheetHeader>
        {row ? (
          <div className="flex-1 min-h-0 overflow-auto p-5 space-y-5">
            <DetailBlock
              label="Scalar fields"
              content={JSON.stringify(row.display, bigintReplacer, 2)}
            />
            {Object.entries(row.vectors).map(([name, v]) => (
              <div key={name}>
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  {name}
                  <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 normal-case tracking-normal">
                    float × {v.dim}
                  </span>
                </p>
                <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[30vh] overflow-auto">
                  {`[`}
                  {v.head.map((n) => formatFloat(n)).join(", ")}
                  {v.tail.length > 0
                    ? `, … (${v.dim - v.head.length - v.tail.length} more), `
                    : v.dim > v.head.length
                      ? `, …`
                      : ""}
                  {v.tail.map((n) => formatFloat(n)).join(", ")}
                  {`]`}
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function bigintReplacer(_: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

function formatFloat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexes tab
// ─────────────────────────────────────────────────────────────────────────────

function IndexesTab({ indexes }: { indexes: MilvusIndex[] }) {
  if (indexes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        No indexes on this collection.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Index name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Metric</TableHead>
            <TableHead>Params</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {indexes.map((i) => (
            <TableRow key={`${i.fieldName}/${i.indexName}`}>
              <TableCell className="font-mono text-xs">{i.fieldName}</TableCell>
              <TableCell className="font-mono text-xs">{i.indexName}</TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className="text-[10px] font-mono uppercase tracking-wider"
                >
                  {i.indexType || "—"}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {i.metricType || "—"}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {Object.keys(i.params).length === 0
                  ? "—"
                  : Object.entries(i.params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats tab
// ─────────────────────────────────────────────────────────────────────────────

function StatsTab({
  stats,
  detail,
}: {
  stats: { key: string; value: string }[];
  detail: CollectionDetail;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
        <Meta
          label="Load state"
          value={detail.loaded ? "loaded" : detail.loadState}
        />
        <Meta label="Field count" value={String(detail.fields.length)} />
        <Meta label="Index count" value={String(detail.indexes.length)} />
      </div>
      {stats.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          No statistics returned.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Key</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.map((s) => (
                <TableRow key={s.key}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.key}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {s.value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-1">
        {label}
      </p>
      <p
        className={cn(
          "text-sm",
          mono && "font-mono text-xs",
          !mono && "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

// Re-use `Loader2` so eslint doesn't drop the import when we add a refresh
// spinner later in dev.
void Loader2;
