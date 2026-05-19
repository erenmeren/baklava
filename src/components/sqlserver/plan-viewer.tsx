"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface PlanNode {
  physicalOp: string;
  logicalOp: string;
  subtreeCost: number;
  estimateRows: number;
  object: string | null;
  costPct: number;
  children: PlanNode[];
}
export interface MissingIndex {
  impact: number;
  statement: string;
  createStatement: string;
}
export interface SqlServerPlan {
  root: PlanNode | null;
  totalCost: number;
  missingIndexes: MissingIndex[];
  rawXml: string;
}

export function PlanViewer({
  plan,
  loading,
  error,
}: {
  plan: SqlServerPlan | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Estimating plan…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 text-sm text-rose-500 font-mono whitespace-pre-wrap">
        {error}
      </div>
    );
  }
  if (!plan || !plan.root) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Run Explain to see the estimated execution plan.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {plan.missingIndexes.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5" />
            {plan.missingIndexes.length} missing index
            {plan.missingIndexes.length === 1 ? "" : "es"} suggested
          </div>
          {plan.missingIndexes.map((mi, i) => (
            <div key={i} className="rounded-md border border-amber-500/20 bg-background/50 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {mi.statement} · impact {mi.impact.toFixed(0)}%
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(mi.createStatement);
                    toast.success("Copied CREATE INDEX");
                  }}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3" /> copy
                </button>
              </div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-words">
                {mi.createStatement}
              </pre>
            </div>
          ))}
        </div>
      ) : null}

      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Estimated total cost {plan.totalCost.toFixed(4)}
      </div>
      <PlanNodeRow node={plan.root} depth={0} />
    </div>
  );
}

function PlanNodeRow({ node, depth }: { node: PlanNode; depth: number }) {
  const heavy = node.costPct >= 30;
  const warm = node.costPct >= 10 && node.costPct < 30;
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 text-xs font-mono"
        style={{ paddingLeft: depth * 18 }}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded px-1.5 py-0.5 tabular-nums text-[10px] w-12 shrink-0",
            heavy
              ? "bg-rose-500/15 text-rose-600"
              : warm
                ? "bg-amber-500/15 text-amber-600"
                : "bg-muted text-muted-foreground",
          )}
        >
          {node.costPct.toFixed(0)}%
        </span>
        <span className="font-medium">{node.physicalOp}</span>
        {node.logicalOp && node.logicalOp !== node.physicalOp ? (
          <span className="text-muted-foreground/60">({node.logicalOp})</span>
        ) : null}
        {node.object ? (
          <span className="text-sky-600 dark:text-sky-400 truncate">{node.object}</span>
        ) : null}
        <span className="ml-auto text-muted-foreground/60 tabular-nums">
          {Math.round(node.estimateRows).toLocaleString()} rows
        </span>
      </div>
      {node.children.map((c, i) => (
        <PlanNodeRow key={i} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}
