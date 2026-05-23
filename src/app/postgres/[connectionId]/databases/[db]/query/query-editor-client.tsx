"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { Button } from "@/components/ui/button";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  AlertCircle,
  Check,
  History as HistoryIcon,
  Loader2,
  Play,
  Trash2,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import {
  ExplainPlanViewer,
  type ExplainPlanRoot,
} from "@/components/postgres/explain-plan-viewer";
import { pushRecentQuery } from "@/lib/postgres/recent-queries";
import { formatSql } from "@/lib/sql/format";
import { editorTheme } from "@/lib/sql/editor-theme";
import { ResultActions } from "@/components/sql/result-actions";
import {
  ShortcutCheatsheet,
  useIsMac,
  runHint,
} from "@/components/sql/keyboard-shortcuts";
import { DbSelector } from "@/components/sql/db-selector";
import { SchemaSelector } from "@/components/sql/schema-selector";

interface QueryResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

interface StatementResult extends QueryResult {
  sql: string;
  isCommand: boolean;
  command: string | null;
}

interface StatementError {
  sql: string;
  error: string;
  durationMs: number;
}

type StatementEntry = StatementResult | StatementError;

interface MultiResponse {
  results: StatementEntry[];
  totalDurationMs: number;
}

interface HistoryItem {
  sql: string;
  rowCount: number | null;
  durationMs: number | null;
  ok: boolean;
  error?: string;
  at: number;
}

interface Props {
  connectionId: string;
  db: string;
  /** Stable per-tab id — different query tabs for the same db keep independent state. */
  queryId: string;
}

type ResultTab = "data" | "messages" | "history" | "explain";

const HISTORY_LIMIT = 25;

function sqlKey(connectionId: string, db: string, queryId: string) {
  return `baklava:pg-query-sql:${connectionId}:${db}:${queryId}`;
}

function historyKey(connectionId: string, db: string, queryId: string) {
  return `baklava:pg-query-history:${connectionId}:${db}:${queryId}`;
}

function searchPathKey(connectionId: string, db: string, queryId: string) {
  return `baklava:pg-query-searchpath:${connectionId}:${db}:${queryId}`;
}

function loadHistory(
  connectionId: string,
  db: string,
  queryId: string,
): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(historyKey(connectionId, db, queryId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(
  connectionId: string,
  db: string,
  queryId: string,
  items: HistoryItem[],
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      historyKey(connectionId, db, queryId),
      JSON.stringify(items),
    );
  } catch {
    // ignore quota errors
  }
}

function loadSql(
  connectionId: string,
  db: string,
  queryId: string,
  defaultSql: string,
): string {
  if (typeof window === "undefined") return defaultSql;
  try {
    const raw = window.localStorage.getItem(sqlKey(connectionId, db, queryId));
    return raw ?? defaultSql;
  } catch {
    return defaultSql;
  }
}

function saveSql(
  connectionId: string,
  db: string,
  queryId: string,
  value: string,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sqlKey(connectionId, db, queryId), value);
  } catch {
    // ignore
  }
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

export function QueryEditorClient({ connectionId, db, queryId }: Props) {
  const defaultSql = `-- ${db}\nSELECT * FROM `;
  const [sqlText, setSqlText] = useState(defaultSql);
  const [phase, setPhase] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Multi-statement support — populated when the user runs more than one
  // SQL statement separated by `;`. Single-statement runs leave this null.
  const [multi, setMulti] = useState<MultiResponse | null>(null);
  const [resultIdx, setResultIdx] = useState(0);
  const [tab, setTab] = useState<ResultTab>("data");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [searchPath, setSearchPath] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isMac = useIsMac();
  const kbd = runHint(isMac);

  // EXPLAIN state — separate from the regular query result so the two
  // panels don't fight. Hitting Explain calls the dedicated endpoint
  // which wraps the user SQL in EXPLAIN (..., FORMAT JSON) inside a
  // BEGIN/ROLLBACK and returns the parsed plan tree.
  const [explainPlan, setExplainPlan] = useState<ExplainPlanRoot | null>(null);
  const [explainPlanJson, setExplainPlanJson] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  // Editor handle — lets us read the current selection so ⌘↵ / Run can run
  // just the highlighted text (falling back to the whole editor).
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const runText = useCallback(() => {
    const view = cmRef.current?.view;
    if (view) {
      const { from, to } = view.state.selection.main;
      if (to > from) return view.state.sliceDoc(from, to);
    }
    return sqlText;
  }, [sqlText]);

  const onFormat = useCallback(() => {
    if (!sqlText.trim()) return;
    try {
      setSqlText(formatSql(sqlText, "postgresql"));
    } catch (e) {
      toast.error("Could not format SQL", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [sqlText]);

  const runExplain = useCallback(async () => {
    const raw = runText().trim();
    if (!raw) return;
    setExplainLoading(true);
    setExplainError(null);
    setExplainPlan(null);
    setTab("explain");
    try {
      const res = await fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/explain`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql: raw, analyze: true }),
        },
      );
      const data = await res.json();
      if (res.ok && data.plan) {
        setExplainPlan(data.plan as ExplainPlanRoot);
        setExplainPlanJson(JSON.stringify(data.plan, null, 2));
      } else {
        setExplainError(data.error || "EXPLAIN failed");
      }
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e));
    } finally {
      setExplainLoading(false);
    }
  }, [connectionId, db, runText]);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // One-shot guard so the cursor-at-end nudge below doesn't fire again on a
  // remount that happens to leave the scaffold untouched.
  const placedCursor = useRef(false);

  useEffect(() => {
    setSqlText(loadSql(connectionId, db, queryId, defaultSql));
    setHistory(loadHistory(connectionId, db, queryId));
    try {
      const sp = window.localStorage.getItem(
        searchPathKey(connectionId, db, queryId),
      );
      setSearchPath(sp && sp.length > 0 ? sp : null);
    } catch {
      /* ignore */
    }
    setHydrated(true);
    // defaultSql intentionally excluded: it would re-trigger on every render
    // and overwrite user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, db, queryId]);

  // Honor ?prefill=… coming from the Cmd+K palette / recent-query links.
  // Strip the param from the URL after applying so a refresh doesn't keep
  // clobbering the user's edits.
  useEffect(() => {
    if (!hydrated) return;
    const prefill = searchParams.get("prefill");
    if (!prefill) return;
    setSqlText(prefill);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("prefill");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [hydrated, searchParams, router, pathname]);

  useEffect(() => {
    if (hydrated) saveHistory(connectionId, db, queryId, history);
  }, [history, hydrated, connectionId, db, queryId]);

  useEffect(() => {
    if (hydrated) saveSql(connectionId, db, queryId, sqlText);
  }, [sqlText, hydrated, connectionId, db, queryId]);

  // When the editor opens with the unchanged scaffold (`SELECT * FROM `), drop
  // the cursor at the end of the line so the user types the table immediately.
  // Skipped if localStorage replaced sqlText with previously-saved SQL.
  useEffect(() => {
    if (!hydrated || placedCursor.current) return;
    placedCursor.current = true;
    if (sqlText !== defaultSql) return;
    const view = cmRef.current?.view;
    if (!view) return;
    const len = view.state.doc.length;
    view.dispatch({ selection: { anchor: len, head: len } });
    view.focus();
    // sqlText / defaultSql intentionally read at-call; this effect runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const k = searchPathKey(connectionId, db, queryId);
      if (searchPath) window.localStorage.setItem(k, searchPath);
      else window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }, [searchPath, hydrated, connectionId, db, queryId]);

  const execute = useCallback(
    async (asExplain = false) => {
      const raw = runText().trim();
      if (!raw) return;
      const finalSql =
        asExplain && !/^\s*explain\b/i.test(raw)
          ? `EXPLAIN ANALYZE ${raw}`
          : raw;

      setPhase("running");
      setError(null);
      setResult(null);
      setMulti(null);
      setResultIdx(0);
      setTab("data");
      const t0 = Date.now();
      try {
        const res = await fetch(
          `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/query`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sql: finalSql,
              multi: true,
              searchPath: searchPath ?? undefined,
            }),
          },
        );
        const data = await res.json();
        const durationMs = data.durationMs ?? Date.now() - t0;
        // Multi-mode response: { results: StatementEntry[], totalDurationMs }
        if (res.ok && data.results && Array.isArray(data.results)) {
          const m = data as MultiResponse;
          setMulti(m);
          // Active result = first successful, else first failure.
          const firstErr = m.results.findIndex((r) => "error" in r);
          const idx =
            m.results.length === 1
              ? 0
              : firstErr === -1
                ? 0
                : firstErr;
          setResultIdx(idx);
          const active = m.results[idx];
          if (active && "error" in active) {
            setError(active.error);
            setPhase("err");
            setTab("messages");
          } else if (active) {
            setResult(active);
            setPhase("ok");
            if (asExplain) setTab("explain");
          }
          setHistory((h) =>
            [
              {
                sql: finalSql,
                rowCount:
                  active && !("error" in active) ? active.rowCount : null,
                durationMs: m.totalDurationMs,
                ok: firstErr === -1,
                error:
                  active && "error" in active ? active.error : undefined,
                at: Date.now(),
              },
              ...h,
            ].slice(0, HISTORY_LIMIT),
          );
          pushRecentQuery(connectionId, {
            sql: finalSql,
            database: db,
            durationMs: m.totalDurationMs,
            rowCount:
              active && !("error" in active) ? active.rowCount : null,
            ok: firstErr === -1,
            at: Date.now(),
          });
          return;
        }
        if (res.ok && !data.error) {
          const r = data as QueryResult;
          setResult(r);
          setPhase("ok");
          if (asExplain) setTab("explain");
          setHistory((h) =>
            [
              {
                sql: finalSql,
                rowCount: r.rowCount,
                durationMs: r.durationMs,
                ok: true,
                at: Date.now(),
              },
              ...h,
            ].slice(0, HISTORY_LIMIT),
          );
          pushRecentQuery(connectionId, {
            sql: finalSql,
            database: db,
            durationMs: r.durationMs,
            rowCount: r.rowCount,
            ok: true,
            at: Date.now(),
          });
        } else {
          const msg = data.error || "Query failed";
          setError(msg);
          setPhase("err");
          setTab("messages");
          setHistory((h) =>
            [
              {
                sql: finalSql,
                rowCount: null,
                durationMs,
                ok: false,
                error: msg,
                at: Date.now(),
              },
              ...h,
            ].slice(0, HISTORY_LIMIT),
          );
          pushRecentQuery(connectionId, {
            sql: finalSql,
            database: db,
            durationMs,
            rowCount: null,
            ok: false,
            at: Date.now(),
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPhase("err");
        setTab("messages");
        pushRecentQuery(connectionId, {
          sql: finalSql,
          database: db,
          durationMs: Date.now() - t0,
          rowCount: null,
          ok: false,
          at: Date.now(),
        });
      }
    },
    [connectionId, db, runText, searchPath],
  );

  // Cmd/Ctrl+Enter to run — bound at the window level so the editor doesn't
  // need to swap extensions on every keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        execute(false);
      } else if (e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        onFormat();
      } else if (!e.shiftKey && (e.key === "E" || e.key === "e")) {
        e.preventDefault();
        runExplain();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [execute, onFormat, runExplain]);

  const extensions = useMemo(
    () => [sql({ dialect: PostgreSQL, upperCaseKeywords: false }), editorTheme],
    [],
  );

  const cellPad = "px-3 py-1";
  const headPad = "px-3 py-1.5";

  const clearHistory = () => {
    setHistory([]);
    toast.success("Query history cleared");
  };

  return (
    <WorkspacePage
      title={
        <span>
          SQL editor{" "}
          <span className="font-mono text-base text-muted-foreground">
            · {db}
          </span>
        </span>
      }
      description={
        <span className="text-xs">
          PostgreSQL · {kbd} to run · results capped at 500 rows
        </span>
      }
      actions={
        <>
          <DbSelector tech="postgres" connectionId={connectionId} currentDb={db} />
          <SchemaSelector
            tech="postgres"
            connectionId={connectionId}
            db={db}
            value={searchPath}
            onChange={setSearchPath}
            mode="search_path"
          />
          <Button
            size="sm"
            onClick={() => execute(false)}
            disabled={phase === "running" || !sqlText.trim()}
          >
            {phase === "running" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Run
            <span className="ml-1 hidden sm:inline text-[10px] font-mono opacity-70">
              {kbd}
            </span>
          </Button>
        </>
      }
    >
      <div className="grid grid-rows-[minmax(180px,40%)_auto_1fr] h-full gap-3 min-h-0">
        {/* Editor */}
        <div className="rounded-md border border-border/60 overflow-hidden bg-card">
          <CodeMirror
            ref={cmRef}
            value={sqlText}
            onChange={setSqlText}
            extensions={extensions}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              foldGutter: true,
              autocompletion: true,
              bracketMatching: true,
              closeBrackets: true,
              indentOnInput: true,
            }}
            placeholder={`-- write SQL · ${kbd} to run · select text to run only that`}
            height="100%"
            className="h-full text-[12.5px]"
          />
        </div>

        {/* Status line */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <StatusIndicator phase={phase} result={result} error={error} kbd={kbd} />
          <div className="ml-auto flex items-center gap-2 text-muted-foreground">
            {result?.truncated ? <span>· truncated to first 500 rows</span> : null}
            <ShortcutCheatsheet
              compact
              onRun={() => execute(false)}
              onFormat={onFormat}
              onExplain={runExplain}
            />
          </div>
        </div>

        {/* Tabs + result */}
        <div className="flex flex-col min-h-0 rounded-md border border-border/60 overflow-hidden">
          <div className="flex items-center border-b border-border/60 bg-muted/30">
            {(
              [
                ["data", "Data", null],
                ["messages", "Messages", error ? "err" : null],
                ["history", "History", null],
                ["explain", "Explain", null],
              ] as const
            ).map(([k, label, dot]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 h-8 px-3 text-[12px] tracking-tight transition-colors",
                  tab === k
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {dot ? (
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      dot === "err" ? "bg-destructive" : "bg-brand",
                    )}
                  />
                ) : null}
                {tab === k ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-2 right-2 -bottom-px h-[2px] rounded-t-sm bg-brand"
                  />
                ) : null}
              </button>
            ))}
            {tab === "history" && history.length > 0 ? (
              <button
                type="button"
                onClick={clearHistory}
                className="ml-auto mr-2 text-[11px] text-muted-foreground hover:text-destructive transition-colors inline-flex items-center gap-1"
              >
                <Trash2 className="size-3" /> clear
              </button>
            ) : null}
            {tab === "data" && result && result.fields.length > 0 ? (
              <ResultActions
                className="ml-auto mr-2"
                fields={result.fields}
                rows={result.rows}
                rowCount={result.rowCount}
                filenameBase={`${db}-query`}
              />
            ) : null}
          </div>

          {/* Multi-statement result tab strip — appears when the user
              runs more than one statement separated by `;`. Switching tabs
              repoints the Data/Messages panes at the chosen statement. */}
          {multi && multi.results.length > 1 && tab !== "history" ? (
            <div className="border-b border-border/40 px-1.5 py-1 flex items-center gap-0.5 overflow-x-auto bg-muted/20">
              <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mr-2 ml-1">
                Results
              </span>
              {multi.results.map((r, i) => {
                const isErr = "error" in r;
                const active = i === resultIdx;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setResultIdx(i);
                      if ("error" in r) {
                        setError(r.error);
                        setResult(null);
                        setPhase("err");
                      } else {
                        setError(null);
                        setResult(r);
                        setPhase("ok");
                      }
                    }}
                    title={r.sql}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-mono transition-colors",
                      active
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      isErr && "text-rose-500 hover:text-rose-500",
                    )}
                  >
                    <span>#{i + 1}</span>
                    <span className="opacity-70">
                      {isErr
                        ? "error"
                        : r.isCommand
                          ? r.command ?? "ok"
                          : `${r.rowCount} row${r.rowCount === 1 ? "" : "s"}`}
                    </span>
                  </button>
                );
              })}
              <span className="ml-auto text-[10px] font-mono text-muted-foreground pr-2">
                {multi.totalDurationMs}ms total
              </span>
            </div>
          ) : null}

          <div className="flex-1 min-h-0 overflow-auto">
            {tab === "data" ? (
              <DataPanel
                phase={phase}
                result={result}
                error={error}
                cellPad={cellPad}
                headPad={headPad}
                kbd={kbd}
              />
            ) : null}
            {tab === "messages" ? (
              <MessagesPanel
                phase={phase}
                result={result}
                error={error}
                sql={sqlText}
              />
            ) : null}
            {tab === "history" ? (
              <HistoryPanel
                history={history}
                onPick={(s) => {
                  setSqlText(s);
                  setTab("data");
                }}
              />
            ) : null}
            {tab === "explain" ? (
              <ExplainPlanViewer
                plan={explainPlan}
                loading={explainLoading}
                error={explainError}
                planJson={explainPlanJson ?? undefined}
              />
            ) : null}
          </div>
        </div>
      </div>
    </WorkspacePage>
  );
}

function StatusIndicator({
  phase,
  result,
  error,
  kbd,
}: {
  phase: "idle" | "running" | "ok" | "err";
  result: QueryResult | null;
  error: string | null;
  kbd: string;
}) {
  if (phase === "idle") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        ready · {kbd} to run
      </span>
    );
  }
  if (phase === "running") {
    return (
      <span className="text-foreground inline-flex items-center gap-1.5">
        <Loader2 className="size-3 animate-spin text-brand" />
        running query…
      </span>
    );
  }
  if (phase === "err") {
    return (
      <span className="text-destructive inline-flex items-center gap-1.5">
        <AlertCircle className="size-3" />
        {error?.split("\n")[0] ?? "query failed"}
      </span>
    );
  }
  if (result) {
    return (
      <span className="text-foreground inline-flex items-center gap-1.5">
        <Check className="size-3 text-brand" />
        <span>
          returned <strong>{result.rowCount.toLocaleString()}</strong> row
          {result.rowCount === 1 ? "" : "s"} ·{" "}
          <strong>{result.durationMs}ms</strong>
        </span>
      </span>
    );
  }
  return null;
}

function DataPanel({
  phase,
  result,
  error,
  cellPad,
  headPad,
  kbd,
}: {
  phase: "idle" | "running" | "ok" | "err";
  result: QueryResult | null;
  error: string | null;
  cellPad: string;
  headPad: string;
  kbd: string;
}) {
  if (phase === "idle" && !result && !error) {
    return (
      <EmptyState
        title="No result yet"
        hint={`Run a query to see rows here. ${kbd} to run.`}
      />
    );
  }
  if (phase === "running" && !result) {
    return (
      <EmptyState title="Running query…" hint="Hold tight, results coming." />
    );
  }
  if (phase === "err") {
    return (
      <EmptyState
        title="Query failed"
        hint={error?.split("\n")[0] ?? ""}
        tone="error"
      />
    );
  }
  if (!result) return null;
  if (result.fields.length === 0) {
    return (
      <EmptyState
        title="Statement executed"
        hint={`No result set · ${result.durationMs}ms`}
        tone="ok"
      />
    );
  }
  return (
    <table className="w-full text-xs font-mono border-collapse">
      <thead className="bg-muted/60 sticky top-0 z-[1]">
        <tr>
          {result.fields.map((f) => (
            <th
              key={f}
              className={cn(
                "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                headPad,
              )}
            >
              {f}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => (
          <tr
            key={i}
            className="border-b border-border/30 hover:bg-foreground/[0.025]"
          >
            {row.map((cell, j) => (
              <td
                key={j}
                className={cn("max-w-[40ch] truncate align-top", cellPad)}
                title={cell == null ? "null" : String(cell)}
              >
                {cell === null ? (
                  <span className="text-muted-foreground/50 italic">null</span>
                ) : typeof cell === "object" ? (
                  <span className="text-brand">{JSON.stringify(cell)}</span>
                ) : typeof cell === "boolean" ? (
                  <span className="text-brand">{cell ? "true" : "false"}</span>
                ) : (
                  String(cell)
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MessagesPanel({
  phase,
  result,
  error,
  sql,
}: {
  phase: "idle" | "running" | "ok" | "err";
  result: QueryResult | null;
  error: string | null;
  sql: string;
}) {
  return (
    <div className="p-3 space-y-1 font-mono text-[11.5px]">
      <div className="text-muted-foreground">
        <Terminal className="inline size-3 mr-1.5 -mt-0.5" />
        {sql.replace(/\s+/g, " ").slice(0, 140)}
        {sql.length > 140 ? "…" : ""}
      </div>
      {phase === "ok" && result ? (
        <div className="text-brand">
          [ok] returned {result.rowCount} row{result.rowCount === 1 ? "" : "s"}{" "}
          in {result.durationMs}ms
          {result.truncated ? " · truncated to 500 rows" : ""}
        </div>
      ) : null}
      {phase === "err" && error ? (
        <pre className="text-destructive whitespace-pre-wrap break-words">
          {error}
        </pre>
      ) : null}
      {phase === "idle" && !result && !error ? (
        <div className="text-muted-foreground italic">
          No messages. Run a query to see output here.
        </div>
      ) : null}
    </div>
  );
}

function HistoryPanel({
  history,
  onPick,
}: {
  history: HistoryItem[];
  onPick: (sql: string) => void;
}) {
  if (history.length === 0) {
    return (
      <EmptyState
        title="No history yet"
        hint="Past queries from this database will show up here."
        icon={<HistoryIcon className="size-4" />}
      />
    );
  }
  return (
    <ul>
      {history.map((h, i) => (
        <li
          key={i}
          className="border-b border-border/30 last:border-b-0 hover:bg-foreground/[0.03]"
        >
          <button
            type="button"
            onClick={() => onPick(h.sql)}
            className="grid grid-cols-[60px_72px_auto_1fr] gap-3 items-center text-left w-full px-3 py-1.5 font-mono text-[11.5px]"
          >
            <span className="text-muted-foreground">
              {formatTimestamp(h.at)}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {h.durationMs != null ? `${h.durationMs}ms` : "—"}
            </span>
            <span
              className={cn(
                "text-[10px] uppercase tracking-wider px-1.5 py-px rounded border tabular-nums",
                h.ok
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              {h.ok ? `${h.rowCount ?? 0} rows` : "error"}
            </span>
            <span className="truncate text-foreground/90">
              {h.error ?? h.sql.replace(/\s+/g, " ")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  title,
  hint,
  tone = "default",
  icon,
}: {
  title: string;
  hint?: string;
  tone?: "default" | "error" | "ok";
  icon?: React.ReactNode;
}) {
  return (
    <div className="h-full grid place-items-center px-6 py-10">
      <div className="text-center space-y-1.5">
        {icon ? (
          <div className="text-muted-foreground/60 grid place-items-center">
            {icon}
          </div>
        ) : null}
        <div
          className={cn(
            "text-[13px] font-medium",
            tone === "error" && "text-destructive",
            tone === "ok" && "text-foreground",
            tone === "default" && "text-foreground",
          )}
        >
          {title}
        </div>
        {hint ? (
          <div className="text-[11.5px] font-mono text-muted-foreground">
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}
