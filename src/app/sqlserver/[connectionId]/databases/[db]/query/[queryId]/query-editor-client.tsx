"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { sql, MSSQL } from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  History as HistoryIcon,
  Loader2,
  Play,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { PlanViewer, type SqlServerPlan } from "@/components/sqlserver/plan-viewer";
import { formatSql } from "@/lib/sql/format";
import { ResultActions } from "@/components/sql/result-actions";
import {
  ShortcutCheatsheet,
  useIsMac,
  runHint,
} from "@/components/sql/keyboard-shortcuts";
import { DbSelector } from "@/components/sql/db-selector";
import { SchemaSelector } from "@/components/sql/schema-selector";

interface HistoryItem {
  sql: string;
  rowCount: number | null;
  durationMs: number | null;
  ok: boolean;
  error?: string;
  at: number;
}

const HISTORY_LIMIT = 25;

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

// Per-tab persistence, scoped by connection + database + queryId so two
// query tabs never clobber each other (mirrors the Postgres editor).
const SQL_KEY = (cid: string, db: string, qid: string) =>
  `baklava:mssql-query-sql:${cid}:${db}:${qid}`;
const HISTORY_KEY = (cid: string, db: string, qid: string) =>
  `baklava:mssql-query-history:${cid}:${db}:${qid}`;
const QUALIFIER_KEY = (cid: string, db: string, qid: string) =>
  `baklava:mssql-query-qualifier:${cid}:${db}:${qid}`;

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function QueryEditorClient({ connectionId, db, queryId }: Props) {
  const { resolvedTheme } = useTheme();
  const defaultSql = `-- ${db}\nSELECT * FROM `;
  const [sqlText, setSqlText] = useState(defaultSql);
  const [hydrated, setHydrated] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [result, setResult] = useState<MultiResult | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState(0);
  const [withStats, setWithStats] = useState(false);
  const [tab, setTab] = useState<"results" | "messages" | "plan" | "history">(
    "results",
  );
  const [plan, setPlan] = useState<SqlServerPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [qualifier, setQualifier] = useState<string | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const isMac = useIsMac();
  const kbd = runHint(isMac);

  // One-shot guard so the cursor-at-end nudge below doesn't fire again on a
  // remount that happens to leave the scaffold untouched.
  const placedCursor = useRef(false);

  // Insert text at the current cursor (used by the schema "insert" button).
  const insertAtCursor = useCallback((text: string) => {
    const view = cmRef.current?.view;
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({
      changes: { from, insert: text },
      selection: { anchor: from + text.length },
    });
    view.focus();
  }, []);

  // Run the highlighted selection if there is one, else the whole editor.
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
      setSqlText(formatSql(sqlText, "tsql"));
    } catch (e) {
      toast.error("Could not format SQL", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [sqlText]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SQL_KEY(connectionId, db, queryId));
      if (saved) setSqlText(saved);
      const rawHist = window.localStorage.getItem(
        HISTORY_KEY(connectionId, db, queryId),
      );
      if (rawHist) {
        const parsed = JSON.parse(rawHist);
        if (Array.isArray(parsed)) setHistory(parsed as HistoryItem[]);
      }
      const q = window.localStorage.getItem(QUALIFIER_KEY(connectionId, db, queryId));
      setQualifier(q && q.length > 0 ? q : null);
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

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        HISTORY_KEY(connectionId, db, queryId),
        JSON.stringify(history),
      );
    } catch {
      /* ignore */
    }
  }, [history, hydrated, connectionId, db, queryId]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const k = QUALIFIER_KEY(connectionId, db, queryId);
      if (qualifier) window.localStorage.setItem(k, qualifier);
      else window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }, [qualifier, hydrated, connectionId, db, queryId]);

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

  const record = useCallback((item: HistoryItem) => {
    setHistory((h) => [item, ...h].slice(0, HISTORY_LIMIT));
  }, []);

  const execute = useCallback(async () => {
    const raw = runText().trim();
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
        record({ sql: raw, rowCount: null, durationMs: null, ok: false, error: data.error, at: Date.now() });
        return;
      }
      const m = data as MultiResult;
      setResult(m);
      const firstErr = m.batches.findIndex((b) => b.error);
      setActiveBatch(firstErr === -1 ? 0 : firstErr);
      setPhase(firstErr === -1 ? "ok" : "err");
      if (firstErr !== -1) setTab("messages");
      const rows = m.batches.reduce(
        (sum, b) => sum + b.resultSets.reduce((s, rs) => s + rs.rowCount, 0),
        0,
      );
      record({
        sql: raw,
        rowCount: rows,
        durationMs: m.totalDurationMs,
        ok: firstErr === -1,
        error: firstErr === -1 ? undefined : m.batches[firstErr]?.error,
        at: Date.now(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConnError(msg);
      setPhase("err");
      record({ sql: raw, rowCount: null, durationMs: null, ok: false, error: msg, at: Date.now() });
    }
  }, [connectionId, runText, db, withStats, record]);

  const explain = useCallback(async () => {
    const raw = runText().trim();
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
  }, [connectionId, runText, db]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void execute();
      } else if (e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        onFormat();
      } else if (!e.shiftKey && (e.key === "E" || e.key === "e")) {
        e.preventDefault();
        void explain();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [execute, onFormat, explain]);

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
      description={`T-SQL · GO splits batches · ${kbd} to run · results capped at 1000 rows`}
      actions={
        <div className="flex items-center gap-2">
          <DbSelector tech="sqlserver" connectionId={connectionId} currentDb={db} />
          <SchemaSelector
            tech="sqlserver"
            connectionId={connectionId}
            db={db}
            value={qualifier}
            onChange={setQualifier}
            mode="qualifier"
            onInsert={insertAtCursor}
          />
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
            <span className="text-[10px] opacity-70">{kbd}</span>
          </Button>
        </div>
      }
    >
      <div className="flex flex-col h-full min-h-0 gap-3">
        <div className="rounded-lg border border-border/60 overflow-hidden bg-card min-h-[180px] max-h-[40vh]">
          <CodeMirror
            ref={cmRef}
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
            placeholder={`-- T-SQL · ${kbd} to run · select text to run only that`}
            height="100%"
          />
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <span>
            {phase === "running"
              ? "running…"
              : phase === "ok" && result
                ? `done · ${result.batches.length} batch${result.batches.length === 1 ? "" : "es"} · ${result.totalDurationMs}ms`
                : phase === "err"
                  ? "completed with errors"
                  : `ready · ${kbd} to run`}
          </span>
          <ShortcutCheatsheet
            compact
            className="ml-auto"
            onRun={execute}
            onFormat={onFormat}
            onExplain={explain}
          />
        </div>

        {connError ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-500 flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            {connError}
          </div>
        ) : null}

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
              {(["results", "messages", "plan", "history"] as const).map((t) => (
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
                  ) : t === "history" ? (
                    <span className="inline-flex items-center gap-1">
                      <HistoryIcon className="size-3" /> History
                    </span>
                  ) : (
                    "Results"
                  )}
                </button>
              ))}
              {tab === "history" && history.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setHistory([]);
                    toast.success("Query history cleared");
                  }}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-destructive transition-colors inline-flex items-center gap-1"
                >
                  <Trash2 className="size-3" /> clear
                </button>
              ) : null}
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {tab === "plan" ? (
                <PlanViewer plan={plan} loading={planLoading} error={planError} />
              ) : tab === "history" ? (
                <HistoryPanel
                  history={history}
                  onPick={(s) => {
                    setSqlText(s);
                    setTab("results");
                  }}
                />
              ) : tab === "results" ? (
                active?.error ? (
                  <div className="p-4 text-sm text-rose-500 font-mono whitespace-pre-wrap">
                    {active.error}
                  </div>
                ) : active && active.resultSets.length > 0 ? (
                  <div className="divide-y divide-border/40">
                    {active.resultSets.map((rs, ri) => (
                      <ResultGrid
                        key={ri}
                        rs={rs}
                        index={ri}
                        multi={active.resultSets.length > 1}
                        filenameBase={`${db}-query`}
                      />
                    ))}
                  </div>
                ) : active ? (
                  <div className="p-4 text-sm text-muted-foreground inline-flex items-center gap-2">
                    <Check className="size-4 text-emerald-500" />
                    {active.rowsAffected.reduce((a, c) => a + c, 0)} row(s) affected · no result set
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    Run a query to see results. {kbd} to run · select text to run
                    only that.
                  </div>
                )
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
      </div>
    </WorkspacePage>
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
      <div className="p-6 text-center text-xs text-muted-foreground">
        No history yet. Past runs from this tab show up here.
      </div>
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
            <span className="text-muted-foreground">{formatTimestamp(h.at)}</span>
            <span className="text-muted-foreground tabular-nums">
              {h.durationMs != null ? `${h.durationMs}ms` : "—"}
            </span>
            <span
              className={cn(
                "text-[10px] uppercase tracking-wider px-1.5 py-px rounded border tabular-nums",
                h.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-500",
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

function ResultGrid({
  rs,
  index,
  multi,
  filenameBase,
}: {
  rs: ResultSet;
  index: number;
  multi: boolean;
  filenameBase: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-2 py-1 bg-muted/20 border-b border-border/40">
        <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          {multi ? `Result set ${index + 1}` : "Result"}
        </span>
        <ResultActions
          fields={rs.fields}
          rows={rs.rows}
          rowCount={rs.rowCount}
          filenameBase={multi ? `${filenameBase}-${index + 1}` : filenameBase}
        />
      </div>
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
