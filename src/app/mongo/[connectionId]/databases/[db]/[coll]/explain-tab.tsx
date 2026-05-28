"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  dbName: string;
  collName: string;
}

interface Explanation {
  explanation: Record<string, unknown>;
}

function findStage(obj: unknown, name: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  if (rec.stage === name) return rec;
  for (const v of Object.values(rec)) {
    const found = findStage(v, name);
    if (found) return found;
  }
  return null;
}

export function ExplainTab({ connectionId, dbName, collName }: Props) {
  const [filter, setFilter] = useState("{}");
  const [verbosity, setVerbosity] = useState<
    "queryPlanner" | "executionStats" | "allPlansExecution"
  >("executionStats");
  const [result, setResult] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let validJson = true;
  try {
    JSON.parse(filter);
  } catch {
    validJson = false;
  }

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/mongo/${connectionId}/databases/${encodeURIComponent(
          dbName,
        )}/collections/${encodeURIComponent(collName)}/explain`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filter, verbosity }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const winningPlan = result
    ? (((result.explanation.queryPlanner ?? {}) as Record<string, unknown>)
        .winningPlan as Record<string, unknown> | undefined)
    : null;
  const execStats = result
    ? (result.explanation.executionStats as Record<string, unknown> | undefined)
    : null;
  const ixScan = winningPlan ? findStage(winningPlan, "IXSCAN") : null;
  const collScan = winningPlan ? findStage(winningPlan, "COLLSCAN") : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_180px_auto] gap-3 items-end">
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Filter (EJSON)
          </label>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="font-mono"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Verbosity
          </label>
          <select
            value={verbosity}
            onChange={(e) =>
              setVerbosity(
                e.target.value as
                  | "queryPlanner"
                  | "executionStats"
                  | "allPlansExecution",
              )
            }
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs font-mono"
          >
            <option value="queryPlanner">queryPlanner</option>
            <option value="executionStats">executionStats</option>
            <option value="allPlansExecution">allPlansExecution</option>
          </select>
        </div>
        <Button onClick={run} disabled={!validJson || loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Explain
        </Button>
      </div>

      {!validJson ? (
        <div className="text-[11px] text-red-500 font-mono">filter has JSON syntax errors</div>
      ) : null}
      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card
              label="Plan"
              value={ixScan ? "IXSCAN" : collScan ? "COLLSCAN" : "?"}
              tone={ixScan ? "good" : collScan ? "bad" : "muted"}
              sub={
                ixScan
                  ? `index: ${String(ixScan.indexName ?? "?")}`
                  : collScan
                    ? "full collection scan"
                    : ""
              }
            />
            <Card
              label="Docs examined"
              value={String(execStats?.totalDocsExamined ?? "—")}
              sub={`returned ${String(execStats?.nReturned ?? "—")}`}
              tone={
                Number(execStats?.totalDocsExamined ?? 0) >
                Number(execStats?.nReturned ?? 0) * 10
                  ? "bad"
                  : "good"
              }
            />
            <Card
              label="Keys examined"
              value={String(execStats?.totalKeysExamined ?? "—")}
            />
            <Card
              label="Execution time"
              value={`${execStats?.executionTimeMillis ?? "—"}ms`}
              tone={
                Number(execStats?.executionTimeMillis ?? 0) > 100
                  ? "bad"
                  : "good"
              }
            />
          </div>

          <div className="border border-border/60 rounded-md overflow-hidden">
            <div className="px-3 py-1.5 border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Full explain plan
            </div>
            <pre className="bg-zinc-950 text-zinc-100 p-4 font-mono text-[11px] leading-relaxed overflow-auto max-h-[600px] whitespace-pre-wrap break-words">
              {JSON.stringify(result.explanation, null, 2)}
            </pre>
          </div>
        </div>
      ) : (
        <div className="px-4 py-12 text-center text-muted-foreground text-xs">
          run an explain to see the query planner output
        </div>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  tone = "muted",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "muted";
}) {
  return (
    <div
      className={cn(
        "border rounded-md p-3",
        tone === "good"
          ? "border-emerald-500/40 bg-emerald-500/[0.04]"
          : tone === "bad"
            ? "border-rose-500/40 bg-rose-500/[0.04]"
            : "border-border/60",
      )}
    >
      <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-lg mt-1 tabular-nums",
          tone === "good" && "text-emerald-700 dark:text-emerald-300",
          tone === "bad" && "text-rose-700 dark:text-rose-300",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate" title={sub}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}
