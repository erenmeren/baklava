"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, MSSQL } from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import {
  AlertCircle,
  Check,
  Loader2,
  Play,
  Sparkles,
  Terminal,
} from "lucide-react";
import { PlanViewer, type SqlServerPlan } from "@/components/sqlserver/plan-viewer";

interface ResultSet {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}
interface BatchResult {
  sql: string;
  resultSets: ResultSet[];
  rowsAffected: number[];
  messages: string[];
  durationMs: number;
  error?: string;
}
interface MultiResult {
  batches: BatchResult[];
  totalDurationMs: number;
}

interface Props {
  connectionId: string;
  /** Active database (from the route). All batches run against this db. */
  db: string;
  /** Stable per-tab id so each query tab keeps its own SQL text. */
  queryId: string;
}

// Per-tab SQL persistence, scoped by connection + database + queryId so two
// query tabs never clobber each other (mirrors the Postgres editor).
const SQL_KEY = (cid: string, db: string, qid: string) =>
  `baklava:mssql-query-sql:${cid}:${db}:${qid}`;

export function QueryEditorClient({ connectionId, db, queryId }: Props) {
  const { resolvedTheme } = useTheme();
  const defaultSql = `-- ${db}\nSELECT @@VERSION AS version;`;
  const [sqlText, setSqlText] = useState(defaultSql);
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [result, setResult] = useState<MultiResult | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState(0);
  const [withStats, setWithStats] = useState(false);
  const [tab, setTab] = useState<"results" | "messages" | "plan">("results");
  const [plan, setPlan] = useState<SqlServerPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SQL_KEY(connectionId, db, queryId));
      if (saved) setSqlText(saved);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [connectionId, db, queryId]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SQL_KEY(connectionId, db, queryId), sqlText);
    } catch {
      /* ignore */
    }
  }, [sqlText, hydrated, connectionId, db, queryId]);

  const execute = useCallback(async () => {
    const raw = sqlText.trim();
    if (!raw) return;
    setPhase("running");
    setConnError(null);
    setResult(null);
    setActiveBatch(0);
    setTab("results");
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sql: raw,
          database: db,
          statistics: withStats,
        }),
      });
      const data = await res.json();
      if (data.error && !data.batches) {
        setConnError(data.error);
        setPhase("err");
        return;
      }
      const m = data as MultiResult;
      setResult(m);
      const firstErr = m.batches.findIndex((b) => b.error);
      setActiveBatch(firstErr === -1 ? 0 : firstErr);
      setPhase(firstErr === -1 ? "ok" : "err");
      if (firstErr !== -1) setTab("messages");
    } catch (e) {
      setConnError(e instanceof Error ? e.message : String(e));
      setPhase("err");
    }
  }, [connectionId, sqlText, db, withStats]);

  const explain = useCallback(async () => {
    const raw = sqlText.trim();
    if (!raw) return;
    setPlanLoading(true);
    setPlanError(null);
    setPlan(null);
    setTab("plan");
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: raw, database: db }),
      });
      const data = await res.json();
      if (data.error && data.root === undefined) {
        setPlanError(data.error);
      } else {
        setPlan(data as SqlServerPlan);
      }
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanLoading(false);
    }
  }, [connectionId, sqlText, db]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void execute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [execute]);

  const extensions = useMemo(
    () => [
      sql({ dialect: MSSQL, upperCaseKeywords: false }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "12.5px" },
        ".cm-scroller": { fontFamily: "var(--font-jetbrains-mono), monospace" },
        ".cm-content": { padding: "10px 0" },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRight: "1px solid var(--border)",
          color: "var(--muted-foreground)",
        },
        ".cm-activeLine": {
          backgroundColor: "color-mix(in oklch, var(--brand) 5%, transparent)",
        },
        ".cm-activeLineGutter": { backgroundColor: "transparent" },
      }),
    ],
    [],
  );

  const active = result?.batches[activeBatch] ?? null;
  const allMessages = result?.batches.flatMap((b, i) =>
    b.messages.map((m) => `[batch ${i + 1}] ${m}`),
  );

  return (
    <WorkspacePage
      title={
        <span>
          SQL editor <span className="text-muted-foreground text-base">· {db}</span>
        </span>
      }
      description="T-SQL · GO splits batches · ⌘↵ to run · results capped at 1000 rows"
      actions={
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={withStats}
              onChange={(e) => setWithStats(e.target.checked)}
              className="accent-brand"
            />
            STATISTICS IO/TIME
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={explain}
            disabled={planLoading || phase === "running"}
            className="gap-1.5"
          >
            {planLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Explain
          </Button>
          <Button
            size="sm"
            onClick={execute}
            disabled={phase === "running"}
            className="gap-1.5"
          >
            {phase === "running" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Run
            <span className="text-[10px] opacity-70">⌘↵</span>
          </Button>
        </div>
      }
    >
      <div className="flex flex-col h-full min-h-0 gap-3">
        <div className="rounded-lg border border-border/60 overflow-hidden bg-card min-h-[180px] max-h-[40vh]">
          <CodeMirror
            value={sqlText}
            onChange={setSqlText}
            extensions={extensions}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              foldGutter: true,
              autocompletion: true,
              bracketMatching: true,
              closeBrackets: true,
            }}
            height="100%"
          />
        </div>

        <div className="text-[11px] font-mono text-muted-foreground">
          {phase === "running"
            ? "running…"
            : phase === "ok" && result
              ? `done · ${result.batches.length} batch${result.batches.length === 1 ? "" : "es"} · ${result.totalDurationMs}ms`
              : phase === "err"
                ? "completed with errors"
                : "ready · ⌘↵ to run"}
        </div>

        {connError ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-500 flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            {connError}
          </div>
        ) : null}

        {result || plan || planLoading || planError ? (
          <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border/60 overflow-hidden">
            {/* Batch strip (only when >1 batch) */}
            {result && result.batches.length > 1 ? (
              <div className="border-b border-border/40 px-1.5 py-1 flex items-center gap-0.5 overflow-x-auto bg-muted/20">
                <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mr-2 ml-1">
                  Batches
                </span>
                {result.batches.map((b, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveBatch(i)}
                    title={b.sql}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-mono transition-colors",
                      i === activeBatch
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      b.error && "text-rose-500 hover:text-rose-500",
                    )}
                  >
                    #{i + 1}
                    <span className="opacity-70">
                      {b.error
                        ? "error"
                        : b.resultSets.length > 0
                          ? `${b.resultSets[0].rowCount} rows`
                          : `${b.rowsAffected.reduce((a, c) => a + c, 0)} affected`}
                    </span>
                  </button>
                ))}
                <span className="ml-auto text-[10px] font-mono text-muted-foreground pr-2">
                  {result.totalDurationMs}ms
                </span>
              </div>
            ) : null}

            {/* Sub-tabs */}
            <div className="flex items-center gap-1 border-b border-border/40 px-2 py-1">
              {(["results", "messages", "plan"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-mono rounded-sm capitalize",
                    tab === t
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "messages" ? (
                    <span className="inline-flex items-center gap-1">
                      <Terminal className="size-3" /> Messages
                    </span>
                  ) : t === "plan" ? (
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="size-3" /> Plan
                    </span>
                  ) : (
                    "Results"
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {tab === "plan" ? (
                <PlanViewer plan={plan} loading={planLoading} error={planError} />
              ) : tab === "results" ? (
                active?.error ? (
                  <div className="p-4 text-sm text-rose-500 font-mono whitespace-pre-wrap">
                    {active.error}
                  </div>
                ) : active && active.resultSets.length > 0 ? (
                  <div className="divide-y divide-border/40">
                    {active.resultSets.map((rs, ri) => (
                      <ResultGrid key={ri} rs={rs} index={ri} multi={active.resultSets.length > 1} />
                    ))}
                  </div>
                ) : active ? (
                  <div className="p-4 text-sm text-muted-foreground inline-flex items-center gap-2">
                    <Check className="size-4 text-emerald-500" />
                    {active.rowsAffected.reduce((a, c) => a + c, 0)} row(s) affected · no result set
                  </div>
                ) : null
              ) : (
                <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">
                  {allMessages && allMessages.length > 0
                    ? allMessages.join("\n")
                    : active?.error
                      ? active.error
                      : "(no messages — enable STATISTICS IO/TIME for read + timing details)"}
                </pre>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </WorkspacePage>
  );
}

function ResultGrid({ rs, index, multi }: { rs: ResultSet; index: number; multi: boolean }) {
  return (
    <div>
      {multi ? (
        <div className="px-3 py-1 text-[10px] uppercase tracking-wider font-mono text-muted-foreground bg-muted/20 border-b border-border/40">
          Result set {index + 1} · {rs.rowCount} rows
        </div>
      ) : null}
      <table className="w-full text-xs font-mono">
        <thead className="bg-muted/40 sticky top-0">
          <tr>
            {rs.fields.map((f, i) => (
              <th key={i} className="px-3 py-1.5 text-left font-semibold whitespace-nowrap">
                {f || `(col ${i + 1})`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rs.rows.map((row, ri) => (
            <tr key={ri} className="border-t border-border/30 hover:bg-muted/30">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1 align-top max-w-[40ch] truncate">
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rs.truncated ? (
        <div className="px-3 py-1.5 text-[10px] font-mono text-amber-600 border-t border-border/40">
          truncated to 1000 rows ({rs.rowCount} total)
        </div>
      ) : null}
    </div>
  );
}

function formatCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined)
    return <span className="text-muted-foreground/40">NULL</span>;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
