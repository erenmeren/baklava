"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Filter,
  GitMerge,
  Hexagon,
  Loader2,
  Pyramid,
  Sigma,
  Square,
  Triangle,
} from "lucide-react";

// Mirror of the backend type — kept local so this component is self-contained.
export interface ExplainPlanRoot {
  Plan: ExplainPlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
  Triggers?: unknown[];
  Settings?: Record<string, string>;
  JIT?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ExplainPlanNode {
  "Node Type": string;
  "Startup Cost"?: number;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  "Plan Width"?: number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Relation Name"?: string;
  "Schema"?: string;
  "Alias"?: string;
  "Index Name"?: string;
  "Filter"?: string;
  "Index Cond"?: string;
  "Hash Cond"?: string;
  "Join Type"?: string;
  "Sort Method"?: string;
  "Sort Space Used"?: number;
  "Sort Space Type"?: string;
  "Sort Key"?: string[];
  "Hash Batches"?: number;
  "Original Hash Batches"?: number;
  "Peak Memory Usage"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Shared Dirtied Blocks"?: number;
  "Shared Written Blocks"?: number;
  "Temp Read Blocks"?: number;
  "Temp Written Blocks"?: number;
  Plans?: ExplainPlanNode[];
  [k: string]: unknown;
}

// ───────────────────────────────────────────────────────────────────────────
// Node-type classification — shape encodes operation class so you can read
// the plan structure from across the room.
// ───────────────────────────────────────────────────────────────────────────
type NodeKind = "scan" | "join" | "aggregate" | "sort" | "limit" | "set" | "other";

function classify(nodeType: string): NodeKind {
  const t = nodeType.toLowerCase();
  if (t.includes("scan")) return "scan";
  if (t.includes("join") || t.includes("nested loop")) return "join";
  if (t.includes("aggregate") || t.includes("hashaggregate") || t.includes("group")) return "aggregate";
  if (t.includes("sort") || t.includes("material") || t.includes("memoize")) return "sort";
  if (t.includes("limit")) return "limit";
  if (t.includes("append") || t.includes("union") || t.includes("intersect") || t.includes("except"))
    return "set";
  return "other";
}

function ShapeIcon({
  kind,
  className,
}: {
  kind: NodeKind;
  className?: string;
}) {
  switch (kind) {
    case "scan":
      return <Database className={className} />;
    case "join":
      return <GitMerge className={className} />;
    case "aggregate":
      return <Sigma className={className} />;
    case "sort":
      return <Pyramid className={className} />;
    case "limit":
      return <Triangle className={className} />;
    case "set":
      return <Hexagon className={className} />;
    default:
      return <Square className={className} />;
  }
}

function shapeStyleForKind(kind: NodeKind): string {
  // Each kind gets a tinted background + border. Subtle, not garish.
  switch (kind) {
    case "scan":
      return "border-sky-500/50 bg-sky-500/[0.06]";
    case "join":
      return "border-violet-500/50 bg-violet-500/[0.06]";
    case "aggregate":
      return "border-emerald-500/50 bg-emerald-500/[0.06]";
    case "sort":
      return "border-amber-500/50 bg-amber-500/[0.06]";
    case "limit":
      return "border-cyan-500/50 bg-cyan-500/[0.06]";
    case "set":
      return "border-fuchsia-500/50 bg-fuchsia-500/[0.06]";
    default:
      return "border-border bg-card";
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Time / row helpers
// ───────────────────────────────────────────────────────────────────────────
function exclusiveTime(node: ExplainPlanNode): number {
  const self = (node["Actual Total Time"] ?? 0) * (node["Actual Loops"] ?? 1);
  const children =
    node.Plans?.reduce(
      (s, c) => s + (c["Actual Total Time"] ?? 0) * (c["Actual Loops"] ?? 1),
      0,
    ) ?? 0;
  return Math.max(0, self - children);
}

function maxExclusive(node: ExplainPlanNode): number {
  let m = exclusiveTime(node);
  for (const c of node.Plans ?? []) m = Math.max(m, maxExclusive(c));
  return m;
}

function formatMs(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1) return `${n.toFixed(2)}ms`;
  if (n < 1000) return `${n.toFixed(1)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(2)}s`;
  return `${Math.round(n / 1000)}s`;
}

function formatRows(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

function formatBlocks(n: number | undefined): string | null {
  if (!n) return null;
  if (n < 1000) return `${n} blk`;
  if (n < 1000 * 128) return `${(n / 128).toFixed(1)}MB`;
  return `${(n / 1024).toFixed(0)}MB`;
}

// ───────────────────────────────────────────────────────────────────────────
// Anti-pattern detection — flags that fire on bad plans
// ───────────────────────────────────────────────────────────────────────────
interface AntiPattern {
  kind: "error" | "warn";
  label: string;
  detail: string;
}

function detectAntiPatterns(node: ExplainPlanNode): AntiPattern[] {
  const out: AntiPattern[] = [];
  const t = node["Node Type"].toLowerCase();
  const actualRows = node["Actual Rows"];
  const planRows = node["Plan Rows"];
  const removed = node["Rows Removed by Filter"];

  // 1. Mis-estimate by > 10×
  if (planRows != null && actualRows != null && actualRows > 0 && planRows > 0) {
    const ratio = actualRows / planRows;
    if (ratio > 10 || ratio < 0.1) {
      out.push({
        kind: "warn",
        label: "Mis-estimate",
        detail: `Planner predicted ${formatRows(planRows)} rows, actual was ${formatRows(actualRows)} — off by ${ratio < 1 ? `${(1 / ratio).toFixed(1)}× over` : `${ratio.toFixed(1)}× under`}. Consider ANALYZE.`,
      });
    }
  }

  // 2. Seq Scan with a filter that drops most rows
  if (t === "seq scan" && removed != null && actualRows != null) {
    const rejection = removed / Math.max(1, removed + actualRows);
    if (rejection > 0.9 && removed > 1000) {
      out.push({
        kind: "warn",
        label: "Missing index?",
        detail: `Sequential Scan on ${node["Relation Name"] ?? "table"} read ${formatRows(removed + actualRows)} rows and filtered ${(rejection * 100).toFixed(0)}% out. An index on the filter column would likely help.`,
      });
    }
  }

  // 3. Sort spilling to disk
  if (
    (t === "sort" || t === "incremental sort") &&
    node["Sort Space Type"] === "Disk"
  ) {
    out.push({
      kind: "error",
      label: "Sort spilled to disk",
      detail: `Sort used ${node["Sort Space Used"]} kB on disk. Raise work_mem or filter earlier.`,
    });
  }

  // 4. Hash spilling to disk (batches > 1)
  if (
    (t === "hash" || t === "hash join") &&
    node["Hash Batches"] != null &&
    node["Hash Batches"] > 1
  ) {
    out.push({
      kind: "warn",
      label: "Hash spilled",
      detail: `Hash used ${node["Hash Batches"]} batches (only 1 fits in memory). Raise work_mem.`,
    });
  }

  // 5. Nested loop with big outer side
  if (t === "nested loop" && node.Plans?.[0]) {
    const outerRows =
      (node.Plans[0]["Actual Rows"] ?? 0) * (node.Plans[0]["Actual Loops"] ?? 1);
    if (outerRows > 10_000) {
      out.push({
        kind: "warn",
        label: "Big nested loop",
        detail: `Nested loop iterates ${formatRows(outerRows)} times. A Hash Join may be cheaper if work_mem allows.`,
      });
    }
  }

  // 6. Bitmap heap scan with lossy pages
  if (
    t === "bitmap heap scan" &&
    typeof node["Exact Heap Blocks"] === "number" &&
    typeof node["Lossy Heap Blocks"] === "number" &&
    (node["Lossy Heap Blocks"] as number) > 0
  ) {
    out.push({
      kind: "warn",
      label: "Bitmap lossy",
      detail: `Bitmap had to fall back to lossy mode. work_mem is too small to track every row precisely.`,
    });
  }

  return out;
}

function plainEnglish(node: ExplainPlanNode): string {
  const t = node["Node Type"];
  const rel = node["Relation Name"] ?? "";
  const idx = node["Index Name"] ?? "";
  const actual = node["Actual Rows"];
  const removed = node["Rows Removed by Filter"];

  if (t === "Seq Scan") {
    if (removed != null && actualRowsOrZero(node) >= 0) {
      const total = removed + actualRowsOrZero(node);
      return `Reads every row of ${rel || "the table"} (${formatRows(total)}) and keeps ${formatRows(actualRowsOrZero(node))}.`;
    }
    return `Reads every row of ${rel || "the table"}.`;
  }
  if (t === "Index Scan" || t === "Index Only Scan") {
    return `Uses index ${idx || "—"} on ${rel || "the table"} to fetch ${formatRows(actual)} row${actual === 1 ? "" : "s"}.`;
  }
  if (t === "Bitmap Heap Scan") {
    return `Materializes a bitmap of rows in ${rel || "the table"} (from one or more index bitmaps below).`;
  }
  if (t === "Hash Join") {
    return `Builds a hash table from the inner side, then probes it once per outer row.`;
  }
  if (t === "Nested Loop") {
    return `For each row on the outer side, looks up matches on the inner side.`;
  }
  if (t === "Merge Join") {
    return `Walks both sorted inputs in lockstep to find matches.`;
  }
  if (t === "Sort") {
    const space = node["Sort Space Used"]
      ? ` using ${node["Sort Space Used"]} kB ${node["Sort Space Type"] ?? ""}`.trim()
      : "";
    return `Sorts ${formatRows(actual)} row${actual === 1 ? "" : "s"}${space}.`;
  }
  if (t === "HashAggregate" || t === "GroupAggregate" || t === "Aggregate") {
    return `Groups and aggregates ${formatRows(actual)} group${actual === 1 ? "" : "s"}.`;
  }
  if (t === "Limit") {
    return `Stops after ${formatRows(actual)} row${actual === 1 ? "" : "s"}.`;
  }
  if (t === "Gather" || t === "Gather Merge") {
    return `Collects rows from parallel workers.`;
  }
  if (t === "Hash") {
    return `Builds a hash table in memory for a later join.`;
  }
  return `${t}.`;
}

function actualRowsOrZero(node: ExplainPlanNode): number {
  return node["Actual Rows"] ?? 0;
}

// ───────────────────────────────────────────────────────────────────────────
// The viewer component
// ───────────────────────────────────────────────────────────────────────────

interface Props {
  plan: ExplainPlanRoot | null;
  /** Set when a fetch is in flight. */
  loading?: boolean;
  /** Set when the EXPLAIN failed. */
  error?: string | null;
  /** Raw plan JSON (string) for copy + permalink. */
  planJson?: string;
}

export function ExplainPlanViewer({ plan, loading, error, planJson }: Props) {
  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" />
        Running EXPLAIN…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 m-3">
        <div className="flex items-center gap-2 text-destructive text-sm font-semibold">
          <AlertTriangle className="size-4" />
          EXPLAIN failed
        </div>
        <pre className="mt-2 text-xs font-mono whitespace-pre-wrap text-destructive/90">
          {error}
        </pre>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Click <span className="mx-1 font-mono">Explain</span> on the toolbar to
        capture a plan.
      </div>
    );
  }

  const root = plan.Plan;
  const maxExcl = Math.max(1, maxExclusive(root));
  const totalTime = plan["Execution Time"];

  return (
    <div className="space-y-4 p-3">
      <PlanSummary plan={plan} planJson={planJson} />
      <PlanNode
        node={root}
        maxExclusive={maxExcl}
        totalTime={totalTime}
        depth={0}
      />
    </div>
  );
}

function PlanSummary({
  plan,
  planJson,
}: {
  plan: ExplainPlanRoot;
  planJson?: string;
}) {
  const [copied, setCopied] = useState(false);
  const exec = plan["Execution Time"];
  const planning = plan["Planning Time"];

  const onCopy = async () => {
    const text = planJson ?? JSON.stringify(plan, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 flex items-baseline justify-between gap-4 flex-wrap">
      <div className="flex items-baseline gap-4 text-xs font-mono">
        {planning != null ? (
          <span>
            <span className="text-muted-foreground uppercase tracking-wider text-[10px] mr-1">
              plan
            </span>
            <span className="tabular-nums">{formatMs(planning)}</span>
          </span>
        ) : null}
        {exec != null ? (
          <span>
            <span className="text-muted-foreground uppercase tracking-wider text-[10px] mr-1">
              exec
            </span>
            <span
              className="tabular-nums font-semibold"
              style={{
                fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
              }}
            >
              {formatMs(exec)}
            </span>
          </span>
        ) : null}
        {plan.Settings && Object.keys(plan.Settings).length > 0 ? (
          <span className="text-muted-foreground">
            modified settings:{" "}
            {Object.entries(plan.Settings)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 rounded border border-border/60 bg-background px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <Copy className="size-2.5" />
        {copied ? "copied" : "copy JSON"}
      </button>
    </div>
  );
}

function PlanNode({
  node,
  maxExclusive: maxExcl,
  totalTime,
  depth,
}: {
  node: ExplainPlanNode;
  maxExclusive: number;
  totalTime: number | undefined;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const kind = classify(node["Node Type"]);
  const shape = shapeStyleForKind(kind);

  const excl = exclusiveTime(node);
  const heat = maxExcl > 0 ? excl / maxExcl : 0;
  const pctOfTotal = totalTime ? (excl / totalTime) * 100 : 0;

  // Mis-estimate ratio for the ring badge.
  const planRows = node["Plan Rows"];
  const actualRows = node["Actual Rows"];
  let misEstimate: { factor: number; over: boolean } | null = null;
  if (planRows != null && actualRows != null && planRows > 0 && actualRows > 0) {
    const ratio = actualRows / planRows;
    if (ratio > 10 || ratio < 0.1) {
      misEstimate = {
        factor: ratio < 1 ? 1 / ratio : ratio,
        over: ratio < 1,
      };
    }
  }

  const antiPatterns = detectAntiPatterns(node);
  const english = plainEnglish(node);

  // Heat color — green when cool, amber mid, red hot. Applied as a strip.
  const heatColor =
    heat > 0.6
      ? "bg-red-500"
      : heat > 0.3
        ? "bg-amber-500"
        : heat > 0.05
          ? "bg-emerald-500"
          : "bg-muted";

  const target = [
    node["Schema"],
    node["Relation Name"],
    node["Alias"] && node["Alias"] !== node["Relation Name"]
      ? `(${node["Alias"]})`
      : null,
  ]
    .filter(Boolean)
    .join(".");

  return (
    <div className="relative">
      <div className={cn("relative flex gap-0", depth > 0 ? "pl-6" : "")}>
        {depth > 0 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-2 top-0 bottom-0 w-px bg-border/50"
          />
        ) : null}

        <div className="flex-1 min-w-0">
          {/* The node card */}
          <div
            className={cn(
              "relative overflow-hidden rounded-lg border-2 px-3 py-2",
              shape,
            )}
          >
            {/* Left heat strip — at-a-glance "how much time did this node burn" */}
            <span
              aria-hidden
              className={cn(
                "absolute left-0 top-0 bottom-0 w-1",
                heatColor,
                heat > 0.05 ? "opacity-90" : "opacity-40",
              )}
            />

            {/* Header row */}
            <div className="flex items-start gap-2 pl-1">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={cn(
                  "inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground shrink-0",
                  !node.Plans?.length && "invisible",
                )}
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </button>
              <ShapeIcon
                kind={kind}
                className="size-3.5 mt-0.5 shrink-0 text-foreground/80"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold">
                    {node["Node Type"]}
                  </span>
                  {target ? (
                    <span className="font-mono text-[11px] text-muted-foreground truncate">
                      {target}
                    </span>
                  ) : null}
                  {node["Join Type"] ? (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      {node["Join Type"]}
                    </span>
                  ) : null}
                  {node["Index Name"] ? (
                    <span className="text-[10px] font-mono text-muted-foreground italic">
                      via {node["Index Name"]}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {english}
                </div>
              </div>

              {/* Right-aligned timing badge */}
              <div className="text-right shrink-0">
                <div
                  className="font-mono text-sm tabular-nums leading-none"
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontWeight: 600,
                  }}
                >
                  {formatMs(excl)}
                </div>
                {totalTime != null && pctOfTotal >= 1 ? (
                  <div className="mt-0.5 text-[10px] font-mono text-muted-foreground tabular-nums">
                    {pctOfTotal.toFixed(0)}%
                  </div>
                ) : null}
              </div>
            </div>

            {/* Stat row */}
            <div className="mt-1.5 pl-1 flex items-center gap-3 flex-wrap text-[10px] font-mono text-muted-foreground tabular-nums">
              {actualRows != null ? (
                <span>
                  rows {formatRows(actualRows)}
                  {node["Actual Loops"] && node["Actual Loops"] > 1 ? (
                    <span className="text-muted-foreground/60">
                      {" "}× {formatRows(node["Actual Loops"])}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {planRows != null ? (
                <span className="opacity-70">
                  est {formatRows(planRows)}
                </span>
              ) : null}
              {misEstimate ? (
                <span
                  className="inline-flex items-center gap-1 rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0 text-amber-700 dark:text-amber-300"
                  title="actual rows vs planner estimate"
                >
                  {misEstimate.over ? "−" : "+"}
                  {misEstimate.factor.toFixed(1)}× off
                </span>
              ) : null}
              {formatBlocks(node["Shared Read Blocks"]) ? (
                <span title="shared blocks read from disk">
                  ↓ {formatBlocks(node["Shared Read Blocks"])}
                </span>
              ) : null}
              {formatBlocks(node["Shared Hit Blocks"]) ? (
                <span
                  className="opacity-70"
                  title="shared blocks served from buffer cache"
                >
                  ✓ {formatBlocks(node["Shared Hit Blocks"])}
                </span>
              ) : null}
              {formatBlocks(node["Temp Written Blocks"]) ? (
                <span
                  className="text-red-600 dark:text-red-400"
                  title="temp data spilled to disk"
                >
                  spill {formatBlocks(node["Temp Written Blocks"])}
                </span>
              ) : null}
            </div>

            {/* Anti-pattern flags */}
            {antiPatterns.length > 0 ? (
              <div className="mt-2 space-y-1">
                {antiPatterns.map((p, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] flex items-start gap-1.5",
                      p.kind === "error"
                        ? "border-red-500/40 bg-red-500/[0.04] text-red-700 dark:text-red-300"
                        : "border-amber-500/40 bg-amber-500/[0.04] text-amber-700 dark:text-amber-300",
                    )}
                  >
                    <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-mono text-[10px] uppercase tracking-wider mr-2">
                        {p.label}
                      </span>
                      <span>{p.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Filter / condition + details toggle */}
            {(node["Filter"] || node["Index Cond"] || node["Hash Cond"] || node["Sort Key"]) ? (
              <div className="mt-2 space-y-1 pl-1">
                {node["Index Cond"] ? (
                  <ConditionRow label="Index Cond" value={node["Index Cond"]} />
                ) : null}
                {node["Hash Cond"] ? (
                  <ConditionRow label="Hash Cond" value={node["Hash Cond"]} />
                ) : null}
                {node["Filter"] ? (
                  <ConditionRow
                    label="Filter"
                    value={node["Filter"]}
                    extra={
                      node["Rows Removed by Filter"]
                        ? `removed ${formatRows(node["Rows Removed by Filter"])}`
                        : undefined
                    }
                  />
                ) : null}
                {node["Sort Key"] && node["Sort Key"].length > 0 ? (
                  <ConditionRow
                    label="Sort Key"
                    value={node["Sort Key"].join(", ")}
                  />
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="mt-2 pl-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {showDetails ? "− hide raw" : "+ raw fields"}
            </button>
            {showDetails ? (
              <pre className="mt-1 ml-1 text-[10px] font-mono text-muted-foreground bg-background/60 rounded p-2 overflow-auto max-h-48">
                {JSON.stringify(node, (k, v) => (k === "Plans" ? undefined : v), 2)}
              </pre>
            ) : null}
          </div>
        </div>
      </div>

      {/* Children */}
      {expanded && node.Plans && node.Plans.length > 0 ? (
        <div className="mt-2 space-y-2">
          {node.Plans.map((c, i) => (
            <PlanNode
              key={i}
              node={c}
              maxExclusive={maxExcl}
              totalTime={totalTime}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConditionRow({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  extra?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5 text-[11px] font-mono">
      <Filter className="size-2.5 text-muted-foreground translate-y-[1px]" />
      <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </span>
      <span className="text-foreground/90 truncate" title={value}>
        {value}
      </span>
      {extra ? (
        <span className="ml-auto text-muted-foreground tabular-nums">
          {extra}
        </span>
      ) : null}
    </div>
  );
}
