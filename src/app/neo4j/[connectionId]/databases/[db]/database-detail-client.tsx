"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { DetailBlock } from "@/components/data/detail-block";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Play,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Wire types — mirror src/lib/connections/neo4j.ts exactly.
// ─────────────────────────────────────────────────────────────────────────────

interface LabelStat {
  label: string;
  count: number;
}
interface RelTypeStat {
  type: string;
  count: number;
}
interface IndexInfo {
  name: string;
  type: string;
  state?: string;
  uniqueness?: string;
  entityType?: string;
  labelsOrTypes: string[];
  properties: string[];
  owningConstraint?: string;
}
interface ConstraintInfo {
  name: string;
  type: string;
  entityType?: string;
  labelsOrTypes: string[];
  properties: string[];
}
interface DatabaseDetail {
  name: string;
  totals: { nodes: number; relationships: number };
  labels: LabelStat[];
  relationshipTypes: RelTypeStat[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
}

type CypherPrimitive = string | number | boolean | null;

type CypherValue =
  | CypherPrimitive
  | CypherValue[]
  | { [k: string]: CypherValue }
  | { __type: "Node"; identity: string; elementId: string; labels: string[]; properties: Record<string, CypherValue> }
  | { __type: "Relationship"; identity: string; elementId: string; type: string; start: string; end: string; properties: Record<string, CypherValue> }
  | {
      __type: "Path";
      start: CypherValue;
      end: CypherValue;
      segments: { start: CypherValue; relationship: CypherValue; end: CypherValue }[];
    }
  | { __type: "Integer"; value: string }
  | { __type: "Unknown"; value: string };

interface CypherCounters {
  nodesCreated: number;
  nodesDeleted: number;
  relationshipsCreated: number;
  relationshipsDeleted: number;
  propertiesSet: number;
  labelsAdded: number;
  labelsRemoved: number;
  indexesAdded: number;
  indexesRemoved: number;
  constraintsAdded: number;
  constraintsRemoved: number;
}

interface CypherResult {
  columns: string[];
  records: Array<Record<string, CypherValue>>;
  truncated: boolean;
  rowCount: number;
  summary: {
    queryType: string;
    resultAvailableAfter: number;
    resultConsumedAfter: number;
    containsUpdates: boolean;
    counters: CypherCounters;
  };
}

const fmt = new Intl.NumberFormat("en-US");

function formatCount(n: number): string {
  if (n < 0) return "—";
  return fmt.format(n);
}

interface Props {
  connectionId: string;
  database: string;
}

export function DatabaseDetailClient({ connectionId, database }: Props) {
  const base = `/api/neo4j/${connectionId}/databases/${encodeURIComponent(database)}`;
  const [tab, setTab] = useState("labels");
  const [detail, setDetail] = useState<DatabaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDetail(data as DatabaseDetail);
      else {
        setError(data.error || "Could not load database");
        toast.error("Could not load", { description: data.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <WorkspacePage
      title={
        <span className="flex items-center gap-2">
          <Link
            href={`/neo4j/${connectionId}/databases`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center"
            title="Back to databases"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span className="font-mono">{database}</span>
        </span>
      }
      description={
        detail ? (
          <span className="inline-flex items-center gap-3 font-mono text-xs">
            <span>
              <span className="text-muted-foreground">nodes </span>
              <span className="text-foreground">
                {fmt.format(detail.totals.nodes)}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">relationships </span>
              <span className="text-foreground">
                {fmt.format(detail.totals.relationships)}
              </span>
            </span>
          </span>
        ) : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      {error ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="labels">Labels</TabsTrigger>
          <TabsTrigger value="rels">Relationship types</TabsTrigger>
          <TabsTrigger value="indexes">Indexes</TabsTrigger>
          <TabsTrigger value="constraints">Constraints</TabsTrigger>
          <TabsTrigger value="cypher">Cypher</TabsTrigger>
        </TabsList>

        <TabsContent value="labels" className="mt-4">
          {detail === null ? (
            <Skeleton className="h-64" />
          ) : (
            <LabelsTab labels={detail.labels} />
          )}
        </TabsContent>

        <TabsContent value="rels" className="mt-4">
          {detail === null ? (
            <Skeleton className="h-64" />
          ) : (
            <RelTypesTab rels={detail.relationshipTypes} />
          )}
        </TabsContent>

        <TabsContent value="indexes" className="mt-4">
          {detail === null ? (
            <Skeleton className="h-64" />
          ) : (
            <IndexesTab indexes={detail.indexes} />
          )}
        </TabsContent>

        <TabsContent value="constraints" className="mt-4">
          {detail === null ? (
            <Skeleton className="h-64" />
          ) : (
            <ConstraintsTab constraints={detail.constraints} />
          )}
        </TabsContent>

        <TabsContent value="cypher" className="mt-4">
          <CypherTab connectionId={connectionId} database={database} />
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels / Rel types
// ─────────────────────────────────────────────────────────────────────────────

function LabelsTab({ labels }: { labels: LabelStat[] }) {
  if (labels.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
        No labels in this database.
      </div>
    );
  }
  const max = Math.max(0, ...labels.map((l) => Math.max(0, l.count)));
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead className="text-right w-[160px]">Nodes</TableHead>
            <TableHead className="w-[40%]">Distribution</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {labels.map((l) => {
            const pct =
              max > 0 && l.count >= 0
                ? Math.max(2, (l.count / max) * 100)
                : 0;
            return (
              <TableRow key={l.label}>
                <TableCell className="font-mono text-xs">{l.label}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {formatCount(l.count)}
                </TableCell>
                <TableCell>
                  {l.count < 0 ? (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      not counted
                    </span>
                  ) : (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RelTypesTab({ rels }: { rels: RelTypeStat[] }) {
  if (rels.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
        No relationship types in this database.
      </div>
    );
  }
  const max = Math.max(0, ...rels.map((r) => Math.max(0, r.count)));
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead className="text-right w-[160px]">Count</TableHead>
            <TableHead className="w-[40%]">Distribution</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rels.map((r) => {
            const pct =
              max > 0 && r.count >= 0
                ? Math.max(2, (r.count / max) * 100)
                : 0;
            return (
              <TableRow key={r.type}>
                <TableCell className="font-mono text-xs">{r.type}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {formatCount(r.count)}
                </TableCell>
                <TableCell>
                  {r.count < 0 ? (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      not counted
                    </span>
                  ) : (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexes / Constraints
// ─────────────────────────────────────────────────────────────────────────────

function IndexesTab({ indexes }: { indexes: IndexInfo[] }) {
  if (indexes.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
        No indexes defined.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Labels / types</TableHead>
            <TableHead>Properties</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Uniqueness</TableHead>
            <TableHead>Owning constraint</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {indexes.map((idx) => (
            <TableRow key={idx.name}>
              <TableCell className="font-mono text-xs">{idx.name}</TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className="text-[10px] font-mono uppercase tracking-wider"
                >
                  {idx.type.toLowerCase()}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {idx.labelsOrTypes.length ? idx.labelsOrTypes.join(", ") : "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {idx.properties.length ? idx.properties.join(", ") : "—"}
              </TableCell>
              <TableCell>
                <IndexStatePill state={idx.state} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                {idx.uniqueness?.toLowerCase() ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {idx.owningConstraint ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function IndexStatePill({ state }: { state?: string }) {
  const s = (state ?? "unknown").toLowerCase();
  const tone =
    s === "online"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : s === "populating"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40"
      : s === "failed"
      ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40"
      : "bg-muted/50 text-muted-foreground border-border/60";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border",
        tone
      )}
    >
      {s}
    </span>
  );
}

function ConstraintsTab({ constraints }: { constraints: ConstraintInfo[] }) {
  if (constraints.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
        No constraints defined.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Labels / types</TableHead>
            <TableHead>Properties</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {constraints.map((c) => (
            <TableRow key={c.name}>
              <TableCell className="font-mono text-xs">{c.name}</TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className="text-[10px] font-mono uppercase tracking-wider"
                >
                  {c.type.toLowerCase().replace(/_/g, " ")}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {c.entityType ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {c.labelsOrTypes.length ? c.labelsOrTypes.join(", ") : "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {c.properties.length ? c.properties.join(", ") : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cypher tab
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_QUERY = "MATCH (n) RETURN n LIMIT 25";
const MAX_VISIBLE_ROWS = 500;

function CypherTab({
  connectionId,
  database,
}: {
  connectionId: string;
  database: string;
}) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [writeMode, setWriteMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CypherResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<CypherValue | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/neo4j/${connectionId}/databases/${encodeURIComponent(database)}/cypher`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: q,
            mode: writeMode ? "write" : "read",
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Query failed");
        setResult(null);
        return;
      }
      setResult(data as CypherResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [query, writeMode, connectionId, database]);

  // Cmd/Ctrl+Enter to run.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!running) run();
      }
    },
    [run, running]
  );

  const visibleRecords = useMemo(
    () => result?.records.slice(0, MAX_VISIBLE_ROWS) ?? [],
    [result]
  );

  return (
    <div className="space-y-4">
      {/* Editor card */}
      <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            Query · Cmd/Ctrl + Enter to run
          </span>
          <div className="flex items-center gap-3">
            <ModeToggle writeMode={writeMode} onChange={setWriteMode} />
            <Button size="sm" onClick={run} disabled={running}>
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Run
            </Button>
          </div>
        </div>
        <Textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          rows={6}
          className="font-mono text-[13px] leading-relaxed rounded-none border-0 focus-visible:ring-0 resize-y min-h-[140px]"
        />
      </div>

      {writeMode ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          <span>
            Write mode is on. Cypher run here can create, modify, or delete
            data in <span className="font-mono">{database}</span>.
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {result ? (
        <ResultsView
          result={result}
          visibleRecords={visibleRecords}
          onInspect={setInspect}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          Run a query to see results.
        </div>
      )}

      <Sheet
        open={Boolean(inspect)}
        onOpenChange={(open) => {
          if (!open) setInspect(null);
        }}
      >
        <SheetContent side="right" className="w-[480px] sm:max-w-full">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm">
              {inspect && typeof inspect === "object" && !Array.isArray(inspect) && "__type" in inspect
                ? `${(inspect as { __type: string }).__type}`
                : "Value"}
            </SheetTitle>
          </SheetHeader>
          {inspect ? (
            <div className="p-4">
              <DetailBlock
                label="value"
                content={JSON.stringify(inspect, null, 2)}
                maxHeightClass="max-h-[80vh]"
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ModeToggle({
  writeMode,
  onChange,
}: {
  writeMode: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border",
          writeMode
            ? "bg-muted/30 text-muted-foreground border-border/60"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
        )}
      >
        <ShieldCheck className="size-3" />
        read
      </span>
      <Switch checked={writeMode} onCheckedChange={onChange} />
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border",
          writeMode
            ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40"
            : "bg-muted/30 text-muted-foreground border-border/60"
        )}
      >
        <ShieldAlert className="size-3" />
        write
      </span>
    </div>
  );
}

function ResultsView({
  result,
  visibleRecords,
  onInspect,
}: {
  result: CypherResult;
  visibleRecords: Array<Record<string, CypherValue>>;
  onInspect: (v: CypherValue) => void;
}) {
  const { columns, summary, truncated, rowCount } = result;

  if (visibleRecords.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
          No records.
        </div>
        <SummaryLine summary={summary} rowCount={rowCount} truncated={truncated} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-card overflow-auto max-h-[60vh]">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c} className="font-mono text-xs">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRecords.map((r, i) => (
              <TableRow key={i}>
                {columns.map((c) => (
                  <TableCell key={c} className="align-top max-w-[420px]">
                    <ValueCell value={r[c]} onInspect={onInspect} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <SummaryLine summary={summary} rowCount={rowCount} truncated={truncated} />
    </div>
  );
}

function SummaryLine({
  summary,
  rowCount,
  truncated,
}: {
  summary: CypherResult["summary"];
  rowCount: number;
  truncated: boolean;
}) {
  const counterEntries = Object.entries(summary.counters).filter(
    ([, v]) => v > 0
  );
  return (
    <div className="text-[11px] font-mono text-muted-foreground space-y-1">
      <div className="flex items-center gap-3 flex-wrap">
        <span>
          <span className="uppercase tracking-wider">rows </span>
          <span className="text-foreground">{fmt.format(rowCount)}</span>
          {truncated ? (
            <span className="ml-1 text-amber-600 dark:text-amber-400">
              (capped at 1000)
            </span>
          ) : null}
        </span>
        <span>
          <span className="uppercase tracking-wider">type </span>
          <span className="text-foreground">{summary.queryType || "—"}</span>
        </span>
        <span>
          <span className="uppercase tracking-wider">available </span>
          <span className="text-foreground">
            {summary.resultAvailableAfter}ms
          </span>
        </span>
        <span>
          <span className="uppercase tracking-wider">consumed </span>
          <span className="text-foreground">
            {summary.resultConsumedAfter}ms
          </span>
        </span>
      </div>
      {counterEntries.length > 0 ? (
        <div className="flex items-center gap-3 flex-wrap">
          {counterEntries.map(([k, v]) => (
            <span key={k}>
              <span className="uppercase tracking-wider">
                {humanizeCounter(k)}{" "}
              </span>
              <span className="text-emerald-700 dark:text-emerald-400">
                {fmt.format(v)}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function humanizeCounter(k: string): string {
  return k.replace(/([A-Z])/g, " $1").trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Cypher value rendering
// ─────────────────────────────────────────────────────────────────────────────

function ValueCell({
  value,
  onInspect,
}: {
  value: CypherValue | undefined;
  onInspect: (v: CypherValue) => void;
}) {
  if (value === undefined) return <span className="text-muted-foreground">—</span>;
  return <CypherValueRenderer value={value} onInspect={onInspect} />;
}

function CypherValueRenderer({
  value,
  onInspect,
}: {
  value: CypherValue;
  onInspect: (v: CypherValue) => void;
}) {
  if (value === null) {
    return <span className="text-muted-foreground italic">null</span>;
  }
  if (typeof value === "string") {
    return <span className="font-mono text-xs break-all">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <span className="font-mono text-xs tabular-nums">{String(value)}</span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0)
      return <span className="text-muted-foreground font-mono text-xs">[]</span>;
    return (
      <button
        type="button"
        onClick={() => onInspect(value)}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border border-border/60 bg-muted/30 hover:bg-muted/60"
      >
        array · {value.length}
      </button>
    );
  }
  if (typeof value === "object" && value !== null) {
    const tagged = value as { __type?: string };
    switch (tagged.__type) {
      case "Node":
        return (
          <NodeChip
            node={value as Extract<CypherValue, { __type: "Node" }>}
            onInspect={onInspect}
          />
        );
      case "Relationship":
        return (
          <RelChip
            rel={value as Extract<CypherValue, { __type: "Relationship" }>}
            onInspect={onInspect}
          />
        );
      case "Path":
        return (
          <PathRender
            path={value as Extract<CypherValue, { __type: "Path" }>}
            onInspect={onInspect}
          />
        );
      case "Integer":
        return (
          <span className="font-mono text-xs tabular-nums">
            {(value as Extract<CypherValue, { __type: "Integer" }>).value}
          </span>
        );
      case "Unknown":
        return (
          <span className="font-mono text-xs text-muted-foreground">
            {(value as Extract<CypherValue, { __type: "Unknown" }>).value}
          </span>
        );
      default:
        // Plain map literal
        return (
          <button
            type="button"
            onClick={() => onInspect(value)}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border border-border/60 bg-muted/30 hover:bg-muted/60"
          >
            object ·{" "}
            {Object.keys(value as Record<string, CypherValue>).length}
          </button>
        );
    }
  }
  return <span className="font-mono text-xs">{String(value)}</span>;
}

function NodeChip({
  node,
  onInspect,
}: {
  node: Extract<CypherValue, { __type: "Node" }>;
  onInspect: (v: CypherValue) => void;
}) {
  const summary = nodeSummary(node);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          onClick={() => onInspect(node)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-mono border border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/20 cursor-pointer"
        >
          <span className="uppercase tracking-wider text-[9px] opacity-80">
            {node.labels.length ? node.labels.join(":") : "node"}
          </span>
          {summary ? (
            <span className="truncate max-w-[220px]">{summary}</span>
          ) : (
            <span className="opacity-60">#{node.identity}</span>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-[360px]">
          <NodeTooltip node={node} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function nodeSummary(node: Extract<CypherValue, { __type: "Node" }>): string {
  // Pick the first interesting property — name > title > id > the first key.
  const keys = Object.keys(node.properties);
  const preferred = ["name", "title", "id", "uuid", "key"];
  const k = preferred.find((p) => keys.includes(p)) ?? keys[0];
  if (!k) return "";
  const v = node.properties[k]!;
  return `${k}=${formatPrimitive(v)}`;
}

function NodeTooltip({
  node,
}: {
  node: Extract<CypherValue, { __type: "Node" }>;
}) {
  const keys = Object.keys(node.properties).slice(0, 8);
  return (
    <div className="space-y-1 text-[11px] font-mono">
      <div className="opacity-70">
        node #{node.identity}
        {node.labels.length ? ` · ${node.labels.join(":")}` : ""}
      </div>
      {keys.length === 0 ? (
        <div className="opacity-60">no properties</div>
      ) : (
        <ul>
          {keys.map((k) => (
            <li key={k} className="truncate">
              <span className="opacity-70">{k}</span>={" "}
              {formatPrimitive(node.properties[k]!)}
            </li>
          ))}
          {Object.keys(node.properties).length > keys.length ? (
            <li className="opacity-60">…</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function RelChip({
  rel,
  onInspect,
}: {
  rel: Extract<CypherValue, { __type: "Relationship" }>;
  onInspect: (v: CypherValue) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInspect(rel)}
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-mono border border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200 hover:bg-orange-500/20"
    >
      <span className="uppercase tracking-wider text-[9px] opacity-80">rel</span>
      <span>:{rel.type}</span>
      <span className="opacity-60">
        #{rel.start}→#{rel.end}
      </span>
    </button>
  );
}

function PathRender({
  path,
  onInspect,
}: {
  path: Extract<CypherValue, { __type: "Path" }>;
  onInspect: (v: CypherValue) => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {path.segments.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i === 0 ? (
            <CypherValueRenderer value={s.start} onInspect={onInspect} />
          ) : null}
          <span className="text-muted-foreground font-mono">-[</span>
          <CypherValueRenderer value={s.relationship} onInspect={onInspect} />
          <span className="text-muted-foreground font-mono">]-&gt;</span>
          <CypherValueRenderer value={s.end} onInspect={onInspect} />
        </span>
      ))}
    </span>
  );
}

function formatPrimitive(v: CypherValue): string {
  if (v === null) return "null";
  if (typeof v === "string") {
    return v.length > 40 ? JSON.stringify(v.slice(0, 40) + "…") : JSON.stringify(v);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[…${v.length}]`;
  if (typeof v === "object" && v !== null) {
    const tagged = v as { __type?: string };
    switch (tagged.__type) {
      case "Integer":
        return (v as Extract<CypherValue, { __type: "Integer" }>).value;
      case "Node": {
        const n = v as Extract<CypherValue, { __type: "Node" }>;
        return `(:${n.labels.join(":") || "node"})`;
      }
      case "Relationship":
        return `[:${(v as Extract<CypherValue, { __type: "Relationship" }>).type}]`;
      case "Path":
        return `(…path)`;
      case "Unknown":
        return (v as Extract<CypherValue, { __type: "Unknown" }>).value;
    }
  }
  return "{…}";
}
