"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { formatBytes } from "@/components/workspace/format";
import { RelativeTime } from "@/components/workspace/relative-time";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Copy,
  Eraser,
  RefreshCcw,
  Trash2,
} from "lucide-react";

interface Column {
  name: string;
  type: string;
  defaultExpression: string;
  codecExpression: string;
  comment: string;
}

interface TableHeaderInfo {
  name: string;
  engine: string;
  rows: number;
  bytes: number;
  modifiedAt: string | null;
  ddl: string;
}

interface TableDetail {
  table: TableHeaderInfo;
  columns: Column[];
}

interface SampleResult {
  columns: string[];
  rows: unknown[][];
}

interface PartitionRow {
  partition: string;
  partsCount: number;
  rows: number;
  bytesOnDisk: number;
  modifiedAt: string | null;
}

interface Props {
  connectionId: string;
  name: string;
}

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function parseTimestamp(s: string | null): number {
  if (!s) return 0;
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function engineTone(engine: string): string {
  const e = engine.toLowerCase();
  if (e.includes("replicated"))
    return "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300";
  if (e.includes("mergetree"))
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (e === "view" || e === "materializedview" || e === "liveview")
    return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  if (e === "log" || e === "tinylog" || e === "stripelog")
    return "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300";
  return "border-border/60 bg-muted/40 text-foreground/80";
}

function stringifyCell(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function TableDetailClient({ connectionId, name }: Props) {
  const router = useRouter();
  const base = `/api/clickhouse/${connectionId}/tables/${encodeURIComponent(name)}`;

  const [tab, setTab] = useState("columns");
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [sample, setSample] = useState<SampleResult | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  const [partitions, setPartitions] = useState<PartitionRow[] | null>(null);
  const [partitionsLoading, setPartitionsLoading] = useState(false);

  const [confirmDrop, setConfirmDrop] = useState(false);
  const [confirmTruncate, setConfirmTruncate] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDetail(data as TableDetail);
      else toast.error("Could not load table", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [base]);

  const loadSample = useCallback(async () => {
    setSampleLoading(true);
    try {
      const res = await fetch(`${base}/sample`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setSample(data as SampleResult);
      else toast.error("Could not load sample", { description: data.error });
    } finally {
      setSampleLoading(false);
    }
  }, [base]);

  const loadPartitions = useCallback(async () => {
    setPartitionsLoading(true);
    try {
      const res = await fetch(`${base}/partitions`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setPartitions(data.partitions as PartitionRow[]);
      else
        toast.error("Could not load partitions", { description: data.error });
    } finally {
      setPartitionsLoading(false);
    }
  }, [base]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Auto-refresh Columns/Overview every 15s
  useEffect(() => {
    if (tab !== "columns") return;
    const i = setInterval(() => loadDetail(), 15_000);
    return () => clearInterval(i);
  }, [tab, loadDetail]);

  // Lazy-load other tabs on first switch
  useEffect(() => {
    if (tab === "sample" && sample === null && !sampleLoading) loadSample();
    if (tab === "partitions" && partitions === null && !partitionsLoading)
      loadPartitions();
  }, [
    tab,
    sample,
    sampleLoading,
    partitions,
    partitionsLoading,
    loadSample,
    loadPartitions,
  ]);

  const dropTable = async () => {
    setBusy(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Table dropped");
        router.push(`/clickhouse/${connectionId}/tables`);
      } else toast.error(data.error || "Could not drop");
    } finally {
      setBusy(false);
      setConfirmDrop(false);
    }
  };

  const truncateTable = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${base}/truncate`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Table truncated");
        await loadDetail();
        if (sample) setSample(null);
        if (partitions) setPartitions(null);
      } else toast.error(data.error || "Could not truncate");
    } finally {
      setBusy(false);
      setConfirmTruncate(false);
    }
  };

  const refreshActive = () => {
    if (tab === "sample") loadSample();
    else if (tab === "partitions") loadPartitions();
    else loadDetail();
  };

  const t = detail?.table;

  return (
    <WorkspacePage
      title={
        <span className="font-mono inline-flex items-center gap-2">
          {name}
          {t ? (
            <>
              <span
                className={cn(
                  "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-tight",
                  engineTone(t.engine)
                )}
                title={t.engine}
              >
                {t.engine}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {formatCompact(t.rows)} rows · {formatBytes(t.bytes)}
              </span>
            </>
          ) : null}
        </span>
      }
      actions={
        <>
          <Link
            href={`/clickhouse/${connectionId}/tables`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={refreshActive}
            disabled={loading || sampleLoading || partitionsLoading}
          >
            <RefreshCcw
              className={cn(
                "size-3.5",
                (loading || sampleLoading || partitionsLoading) && "animate-spin"
              )}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmTruncate(true)}
            disabled={busy}
          >
            <Eraser className="size-3.5" />
            Truncate
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmDrop(true)}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
            Drop
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="sample">Sample</TabsTrigger>
          <TabsTrigger value="partitions">Partitions</TabsTrigger>
          <TabsTrigger value="ddl">DDL</TabsTrigger>
        </TabsList>

        {/* ── Columns ────────────────────────────────────────────────────── */}
        <TabsContent value="columns" className="pt-4">
          {detail ? (
            detail.columns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No columns.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/30">
                    <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left w-[28%]">Type</th>
                      <th className="px-3 py-2 text-left w-[20%]">Default</th>
                      <th className="px-3 py-2 text-left w-[15%]">Codec</th>
                      <th className="px-3 py-2 text-left">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.columns.map((c) => (
                      <tr
                        key={c.name}
                        className="border-t border-border/40 hover:bg-muted/30"
                      >
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {c.name}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
                            {c.type}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                          {c.defaultExpression || (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                          {c.codecExpression || (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground truncate">
                          {c.comment || (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </TabsContent>

        {/* ── Sample ─────────────────────────────────────────────────────── */}
        <TabsContent value="sample" className="pt-4">
          {sampleLoading || sample === null ? (
            <Skeleton className="h-64 w-full" />
          ) : sample.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Table is empty.</p>
          ) : (
            <SampleGrid sample={sample} />
          )}
        </TabsContent>

        {/* ── Partitions ─────────────────────────────────────────────────── */}
        <TabsContent value="partitions" className="pt-4">
          {partitionsLoading || partitions === null ? (
            <Skeleton className="h-64 w-full" />
          ) : partitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active partitions. (Non-MergeTree engines don&apos;t have parts.)
            </p>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/30">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left">Partition</th>
                    <th className="px-3 py-2 text-left w-[100px]">Parts</th>
                    <th className="px-3 py-2 text-left w-[140px]">Rows</th>
                    <th className="px-3 py-2 text-left w-[120px]">Bytes</th>
                    <th className="px-3 py-2 text-left w-[140px]">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {partitions.map((p) => {
                    const ts = parseTimestamp(p.modifiedAt);
                    return (
                      <tr
                        key={p.partition}
                        className="border-t border-border/40 hover:bg-muted/30"
                      >
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {p.partition}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                          {p.partsCount}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCompact(p.rows)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatBytes(p.bytesOnDisk)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                          {ts > 0 ? <RelativeTime value={ts} /> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── DDL ────────────────────────────────────────────────────────── */}
        <TabsContent value="ddl" className="pt-4">
          {detail ? (
            <DetailBlock label="CREATE TABLE" content={detail.table.ddl} />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDrop} onOpenChange={setConfirmDrop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Drop table?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-mono">{name}</span> and all its data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={dropTable}>Drop</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmTruncate} onOpenChange={setConfirmTruncate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Truncate table?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all rows from{" "}
              <span className="font-mono">{name}</span>. The schema is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={truncateTable}>
              Truncate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SampleGrid({ sample }: { sample: SampleResult }) {
  return (
    <div className="rounded-lg border border-border/60 overflow-auto max-h-[70vh]">
      <table className="w-full text-xs font-mono">
        <thead className="bg-muted/50 sticky top-0 z-10">
          <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <th className="px-2 py-2 text-left w-10 font-semibold border-r border-border/40">
              #
            </th>
            {sample.columns.map((c) => (
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
          {sample.rows.map((row, i) => (
            <tr
              key={i}
              className="border-t border-border/30 hover:bg-muted/30"
            >
              <td className="px-2 py-1.5 align-top tabular-nums text-muted-foreground border-r border-border/40">
                {i + 1}
              </td>
              {sample.columns.map((c, ci) => {
                const v = row[ci];
                const isNull = v == null;
                return (
                  <td
                    key={c}
                    className={cn(
                      "px-3 py-1.5 align-top whitespace-nowrap max-w-[50ch] truncate",
                      isNull && "text-muted-foreground/60 italic"
                    )}
                    title={isNull ? "null" : stringifyCell(v)}
                  >
                    {isNull ? "null" : stringifyCell(v)}
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

function DetailBlock({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <Button
          size="xs"
          variant="ghost"
          onClick={onCopy}
          className="h-6 px-2"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "copied" : "copy"}
        </Button>
      </div>
      <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
        {content}
      </pre>
    </div>
  );
}
