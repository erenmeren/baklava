"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  AlertCircle,
  Check,
  History as HistoryIcon,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

interface QueryResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
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
  const defaultSql = `-- ${db}\nselect now() as now, current_user as user;`;
  const [sqlText, setSqlText] = useState(defaultSql);
  const [phase, setPhase] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ResultTab>("data");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setSqlText(loadSql(connectionId, db, queryId, defaultSql));
    setHistory(loadHistory(connectionId, db, queryId));
    setHydrated(true);
    // defaultSql intentionally excluded: it would re-trigger on every render
    // and overwrite user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, db, queryId]);

  useEffect(() => {
    if (hydrated) saveHistory(connectionId, db, queryId, history);
  }, [history, hydrated, connectionId, db, queryId]);

  useEffect(() => {
    if (hydrated) saveSql(connectionId, db, queryId, sqlText);
  }, [sqlText, hydrated, connectionId, db, queryId]);

  const execute = useCallback(
    async (asExplain = false) => {
      const raw = sqlText.trim();
      if (!raw) return;
      const finalSql =
        asExplain && !/^\s*explain\b/i.test(raw)
          ? `EXPLAIN ANALYZE ${raw}`
          : raw;

      setPhase("running");
      setError(null);
      setResult(null);
      setTab("data");
      const t0 = Date.now();
      try {
        const res = await fetch(
          `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/query`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sql: finalSql }),
          },
        );
        const data = await res.json();
        const durationMs = data.durationMs ?? Date.now() - t0;
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
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPhase("err");
        setTab("messages");
      }
    },
    [connectionId, db, sqlText],
  );

  // Cmd/Ctrl+Enter to run — bound at the window level so the editor doesn't
  // need to swap extensions on every keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        execute(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [execute]);

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, upperCaseKeywords: false }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "12.5px" },
        ".cm-scroller": { fontFamily: "var(--font-jetbrains-mono), monospace" },
        ".cm-content": { padding: "10px 0" },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRight: "1px solid var(--border)",
          color: "var(--muted-foreground)",
        },
        ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--brand) 5%, transparent)" },
        ".cm-activeLineGutter": { backgroundColor: "transparent" },
      }),
    ],
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
          PostgreSQL · ⌘↵ to run · results capped at 500 rows
        </span>
      }
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => execute(true)}
            disabled={phase === "running"}
            title="Run with EXPLAIN ANALYZE"
          >
            <Sparkles className="size-3.5" />
            Explain
          </Button>
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
              ⌘↵
            </span>
          </Button>
        </>
      }
    >
      <div className="grid grid-rows-[minmax(180px,40%)_auto_1fr] h-full gap-3 min-h-0">
        {/* Editor */}
        <div className="rounded-md border border-border/60 overflow-hidden bg-card">
          <CodeMirror
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
            placeholder="-- write SQL · ⌘↵ to run"
            height="100%"
            className="h-full text-[12.5px]"
          />
        </div>

        {/* Status line */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <StatusIndicator phase={phase} result={result} error={error} />
          {result?.truncated ? (
            <span className="ml-auto text-muted-foreground">
              · truncated to first 500 rows
            </span>
          ) : null}
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
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {tab === "data" ? (
              <DataPanel
                phase={phase}
                result={result}
                error={error}
                cellPad={cellPad}
                headPad={headPad}
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
              <ExplainPanel result={result} phase={phase} />
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
}: {
  phase: "idle" | "running" | "ok" | "err";
  result: QueryResult | null;
  error: string | null;
}) {
  if (phase === "idle") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        ready · ⌘↵ to run
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
}: {
  phase: "idle" | "running" | "ok" | "err";
  result: QueryResult | null;
  error: string | null;
  cellPad: string;
  headPad: string;
}) {
  if (phase === "idle" && !result && !error) {
    return (
      <EmptyState
        title="No result yet"
        hint="Run a query to see rows here. ⌘↵ to run."
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

function ExplainPanel({
  result,
  phase,
}: {
  result: QueryResult | null;
  phase: "idle" | "running" | "ok" | "err";
}) {
  const planRows =
    phase === "ok" &&
    result &&
    result.fields.length === 1 &&
    result.fields[0] === "QUERY PLAN"
      ? (result.rows.map((r) => String(r[0])) as string[])
      : null;

  if (!planRows) {
    return (
      <EmptyState
        title="No plan yet"
        hint="Click Explain on the toolbar to capture a query plan."
        icon={<Sparkles className="size-4" />}
      />
    );
  }
  return (
    <pre className="p-3 text-[11.5px] font-mono leading-[1.6] whitespace-pre">
      {planRows.map((line, i) => {
        const isArrow = /^->/.test(line.trim());
        const isHot = /actual time=[\d.]+\.\.([\d.]+)/.exec(line);
        const slow = isHot && parseFloat(isHot[1]) > 50;
        return (
          <span
            key={i}
            className={cn(
              "block",
              slow
                ? "text-destructive"
                : isArrow
                  ? "text-brand"
                  : "text-foreground/90",
            )}
          >
            {line}
          </span>
        );
      })}
    </pre>
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
