"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { sql, MySQL } from "@codemirror/lang-sql";
import { Button } from "@/components/ui/button";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Database,
  History as HistoryIcon,
  Loader2,
  Play,
  Trash2,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { formatSql } from "@/lib/sql/format";
import { editorTheme } from "@/lib/sql/editor-theme";
import { smartSqlCompletions } from "@/lib/sql/editor-completions";
import { MYSQL_KEYWORDS, MYSQL_TYPES } from "@/lib/sql/dialect-keywords";
import { ResultActions } from "@/components/sql/result-actions";
import { DataPagination } from "@/components/sql/pagination";
import {
  ShortcutCheatsheet,
  useIsMac,
  runHint,
} from "@/components/sql/keyboard-shortcuts";

// ── MySQL API response shapes ────────────────────────────────────────────────
// POST /api/mysql/[id]/databases/[db]/query  body {sql}
//   { results: StatementResult[], errors: StatementError[] }
// Rows are objects keyed by column name (not arrays). MySQL runs each statement
// in order and STOPS at the first error, which lands in `errors`.

type ColumnValue = string | number | boolean | null;

interface StatementResult {
  statement: string;
  columns: string[];
  rows: Record<string, ColumnValue>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  command: string | null;
  isCommand: boolean;
}

interface StatementError {
  statement: string;
  error: string;
}

interface QueryResponse {
  results: StatementResult[];
  errors: StatementError[];
}

// EXPLAIN: { rows, columns } | { error }
interface ExplainResponse {
  columns: string[];
  rows: Record<string, ColumnValue>[];
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
  return `baklava:my-query-sql:${connectionId}:${db}:${queryId}`;
}

function historyKey(connectionId: string, db: string, queryId: string) {
  return `baklava:my-query-history:${connectionId}:${db}:${queryId}`;
}

function loadHistory(
  connectionId: string,
  db: string,
  queryId: string,
): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(
      historyKey(connectionId, db, queryId),
    );
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

/** Pull plain cell values out of a row-object in column order for export/render. */
function rowToArray(row: Record<string, ColumnValue>, columns: string[]) {
  return columns.map((c) => row[c] ?? null);
}

export function QueryEditorClient({ connectionId, db, queryId }: Props) {
  // `_` is the route sentinel for "no default database / server-level".
  const noDb = db === "_";
  const dbLabel = noDb ? "(no database)" : db;
  const defaultSql = `-- ${dbLabel}\nSELECT\n  *\nFROM\n  `;

  const [sqlText, setSqlText] = useState(defaultSql);
  const [phase, setPhase] = useState<"idle" | "running" | "ok" | "err">("idle");
  // The active (selected) statement result and its error, derived from the
  // multi-statement response below.
  const [active, setActive] = useState<StatementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [resultIdx, setResultIdx] = useState(0);
  const [totalDurationMs, setTotalDurationMs] = useState<number | null>(null);
  const [tab, setTab] = useState<ResultTab>("data");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const { resolvedTheme } = useTheme();
  const isMac = useIsMac();
  const kbd = runHint(isMac);

  // EXPLAIN state — MySQL EXPLAIN returns a plain row/column grid, not a plan
  // tree, so we render it as a simple table.
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  // Editor handle — lets ⌘↵ / Run run just the highlighted text.
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const abortRef = useRef<AbortController | null>(null);
  const explainAbortRef = useRef<AbortController | null>(null);

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
      // formatSql has no dedicated MySQL dialect; postgresql is the closest fit.
      setSqlText(formatSql(sqlText, "postgresql"));
    } catch (e) {
      toast.error("Could not format SQL", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [sqlText]);

  // Repoint the Data/Messages panes at the statement at index `i`.
  const selectResult = useCallback(
    (resp: QueryResponse, i: number) => {
      setResultIdx(i);
      const r = resp.results[i];
      // The first error (if any) attaches to the statement *after* the last
      // successful one — MySQL stops at the first failure.
      const errForThis =
        i === resp.results.length - 1 && resp.errors.length > 0
          ? resp.errors[0].error
          : null;
      if (r) {
        setActive(r);
        setError(errForThis);
        setPhase(errForThis ? "err" : "ok");
      } else {
        setActive(null);
        setError(resp.errors[0]?.error ?? null);
        setPhase("err");
      }
    },
    [],
  );

  const runExplain = useCallback(async () => {
    const raw = runText().trim();
    if (!raw) return;
    explainAbortRef.current?.abort();
    const ac = new AbortController();
    explainAbortRef.current = ac;
    setExplainLoading(true);
    setExplainError(null);
    setExplain(null);
    setTab("explain");
    try {
      const res = await fetch(
        `/api/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql: raw, explain: true }),
          signal: ac.signal,
        },
      );
      const data = await res.json();
      if (res.ok && data.columns && data.rows) {
        setExplain(data as ExplainResponse);
      } else {
        setExplainError(data.error || "EXPLAIN failed");
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setExplainError(e instanceof Error ? e.message : String(e));
    } finally {
      setExplainLoading(false);
    }
  }, [connectionId, db, runText]);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // One-shot guard so the cursor-at-end nudge below doesn't refire on a remount.
  const placedCursor = useRef(false);

  useEffect(() => {
    setSqlText(loadSql(connectionId, db, queryId, defaultSql));
    setHistory(loadHistory(connectionId, db, queryId));
    setHydrated(true);
    // defaultSql intentionally excluded: it would re-trigger on every render
    // and overwrite user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, db, queryId]);

  // Honor ?prefill=… coming from the Cmd+K palette / recent-query links.
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

  // When the editor opens with the unchanged scaffold, drop the cursor at the
  // end so the user types the table immediately.
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

  // Abort any in-flight fetches on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      explainAbortRef.current?.abort();
    },
    [],
  );

  const execute = useCallback(async () => {
    const raw = runText().trim();
    if (!raw) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setPhase("running");
    setError(null);
    setActive(null);
    setResponse(null);
    setResultIdx(0);
    setTotalDurationMs(null);
    setTab("data");
    const t0 = Date.now();
    try {
      const res = await fetch(
        `/api/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql: raw }),
          signal: ac.signal,
        },
      );
      const data = await res.json();

      // Top-level failure (no per-statement results — e.g. connection error).
      if (!res.ok || !Array.isArray(data.results)) {
        const msg = data.error || "Query failed";
        setError(msg);
        setPhase("err");
        setTab("messages");
        setHistory((h) =>
          [
            {
              sql: raw,
              rowCount: null,
              durationMs: Date.now() - t0,
              ok: false,
              error: msg,
              at: Date.now(),
            },
            ...h,
          ].slice(0, HISTORY_LIMIT),
        );
        return;
      }

      const resp = data as QueryResponse;
      setResponse(resp);
      const sumDuration = resp.results.reduce(
        (acc, r) => acc + (r.durationMs ?? 0),
        0,
      );
      setTotalDurationMs(sumDuration);

      const hasError = resp.errors.length > 0;
      // Land on the first error's statement if there is one, else the first
      // statement that produced a result set, else the first statement.
      let idx = 0;
      if (resp.results.length > 0) {
        if (hasError) {
          idx = resp.results.length - 1;
        } else {
          const firstSet = resp.results.findIndex((r) => r.columns.length > 0);
          idx = firstSet === -1 ? 0 : firstSet;
        }
      }

      if (resp.results.length === 0) {
        // Statement(s) failed before producing any result.
        const msg = resp.errors[0]?.error ?? "Query failed";
        setError(msg);
        setPhase("err");
        setTab("messages");
      } else {
        selectResult(resp, idx);
        if (hasError) setTab("messages");
      }

      const lastOk = resp.results.find((r) => !r.isCommand);
      setHistory((h) =>
        [
          {
            sql: raw,
            rowCount: lastOk ? lastOk.rowCount : null,
            durationMs: sumDuration,
            ok: !hasError,
            error: hasError ? resp.errors[0]?.error : undefined,
            at: Date.now(),
          },
          ...h,
        ].slice(0, HISTORY_LIMIT),
      );
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase("err");
      setTab("messages");
      setHistory((h) =>
        [
          {
            sql: raw,
            rowCount: null,
            durationMs: Date.now() - t0,
            ok: false,
            error: msg,
            at: Date.now(),
          },
          ...h,
        ].slice(0, HISTORY_LIMIT),
      );
    }
  }, [connectionId, db, runText, selectResult]);

  // Window-level shortcuts: ⌘↵ run · ⌘⇧F format · ⌘E explain.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "Enter") {
        e.preventDefault();
        execute();
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
    () => [
      sql({ dialect: MySQL, upperCaseKeywords: false }),
      smartSqlCompletions({
        keywords: MYSQL_KEYWORDS,
        types: MYSQL_TYPES,
      }),
      editorTheme,
    ],
    [],
  );

  const cellPad = "px-3 py-1";
  const headPad = "px-3 py-1.5";

  const clearHistory = () => {
    setHistory([]);
    toast.success("Query history cleared");
  };

  const activeRows = useMemo(
    () =>
      active ? active.rows.map((r) => rowToArray(r, active.columns)) : [],
    [active],
  );

  return (
    <WorkspacePage
      title={
        <span>
          SQL editor{" "}
          <span className="font-mono text-base text-muted-foreground">
            · {dbLabel}
          </span>
        </span>
      }
      description={
        <span className="text-xs">
          MySQL · {kbd} to run · results capped at 1000 rows
        </span>
      }
      actions={
        <>
          <MysqlDbSelector connectionId={connectionId} currentDb={db} />
          <Button
            size="sm"
            onClick={() => execute()}
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
              // Disabled — we add our own context-aware autocompletion above.
              autocompletion: false,
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
          <StatusIndicator
            phase={phase}
            result={active}
            error={error}
            kbd={kbd}
          />
          <div className="ml-auto flex items-center gap-2 text-muted-foreground">
            {active?.truncated ? <span>· first 1000 rows — more exist</span> : null}
            <ShortcutCheatsheet
              compact
              onRun={() => execute()}
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
            {tab === "data" && active && active.columns.length > 0 ? (
              <ResultActions
                className="ml-auto mr-2"
                fields={active.columns}
                rows={activeRows}
                rowCount={active.rowCount}
                filenameBase={`${noDb ? "server" : db}-query`}
              />
            ) : null}
          </div>

          {/* Multi-statement result strip — appears when more than one
              statement ran. Switching repoints the Data/Messages panes. */}
          {response && response.results.length > 1 && tab !== "history" ? (
            <div className="border-b border-border/40 px-1.5 py-1 flex items-center gap-0.5 overflow-x-auto bg-muted/20">
              <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mr-2 ml-1">
                Results
              </span>
              {response.results.map((r, i) => {
                const isActive = i === resultIdx;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectResult(response, i)}
                    title={r.statement}
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-mono transition-colors",
                      isActive
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span>#{i + 1}</span>
                    <span className="opacity-70">
                      {r.isCommand
                        ? r.command ?? "ok"
                        : `${r.rowCount} row${r.rowCount === 1 ? "" : "s"}`}
                    </span>
                  </button>
                );
              })}
              {response.errors.length > 0 ? (
                <span
                  className="shrink-0 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-mono text-rose-500"
                  title={response.errors[0].error}
                >
                  <AlertCircle className="size-3" /> error
                </span>
              ) : null}
              {totalDurationMs != null ? (
                <span className="ml-auto text-[10px] font-mono text-muted-foreground pr-2">
                  {totalDurationMs}ms total
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="flex-1 min-h-0 overflow-auto">
            {tab === "data" ? (
              <DataPanel
                phase={phase}
                result={active}
                rows={activeRows}
                error={error}
                cellPad={cellPad}
                headPad={headPad}
                kbd={kbd}
              />
            ) : null}
            {tab === "messages" ? (
              <MessagesPanel
                phase={phase}
                result={active}
                error={error}
                errors={response?.errors ?? []}
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
              <ExplainPanel
                explain={explain}
                loading={explainLoading}
                error={explainError}
                cellPad={cellPad}
                headPad={headPad}
              />
            ) : null}
          </div>
        </div>
      </div>
    </WorkspacePage>
  );
}

/**
 * Inline DB selector. The shared `<DbSelector>` is hardwired to
 * postgres|sqlserver techs, so MySQL gets its own minimal copy that lists
 * `/api/mysql/[id]/databases` and navigates to the chosen db's /query route.
 */
function MysqlDbSelector({
  connectionId,
  currentDb,
}: {
  connectionId: string;
  currentDb: string;
}) {
  const [items, setItems] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const noDb = currentDb === "_";

  useEffect(() => {
    if (!open || items) return;
    let cancelled = false;
    fetch(`/api/mysql/${connectionId}/databases`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const arr = (d.databases as Array<{ name: string }> | undefined) ?? [];
        setItems(arr.map((x) => x.name));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, items, connectionId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Switch database"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input/60 bg-transparent px-2.5 text-xs font-mono text-foreground transition-colors hover:bg-muted"
          >
            <Database className="size-3.5 text-muted-foreground" />
            <span className="max-w-[180px] truncate">
              {noDb ? "(no database)" : currentDb}
            </span>
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-60 p-1">
        <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Switch database
        </div>
        {!items ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            (none)
          </div>
        ) : (
          <ul className="max-h-64 overflow-auto">
            {items.map((name) => {
              const isCurrent = name === currentDb;
              const href = `/mysql/${connectionId}/databases/${encodeURIComponent(name)}/query`;
              return (
                <li key={name}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded px-2 py-1 text-xs font-mono transition-colors",
                      isCurrent
                        ? "bg-foreground/10 text-foreground"
                        : "text-foreground/80 hover:bg-foreground/5",
                    )}
                    title={
                      isCurrent
                        ? "Current database"
                        : `Open new query in ${name}`
                    }
                  >
                    <span className="truncate">{name}</span>
                    {isCurrent ? <Check className="size-3 shrink-0" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border/40 px-2 py-1 text-[10px] text-muted-foreground">
          opens a new query tab
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StatusIndicator({
  phase,
  result,
  error,
  kbd,
}: {
  phase: "idle" | "running" | "ok" | "err";
  result: StatementResult | null;
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
          {result.isCommand ? (
            <>
              <strong>{result.command ?? "OK"}</strong> ·{" "}
            </>
          ) : (
            <>
              returned <strong>{result.rowCount.toLocaleString()}</strong> row
              {result.rowCount === 1 ? "" : "s"} ·{" "}
            </>
          )}
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
  rows,
  error,
  cellPad,
  headPad,
  kbd,
}: {
  phase: "idle" | "running" | "ok" | "err";
  result: StatementResult | null;
  rows: ColumnValue[][];
  error: string | null;
  cellPad: string;
  headPad: string;
  kbd: string;
}) {
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  // Reset paging when the result set changes.
  useEffect(() => {
    setOffset(0);
  }, [result]);

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
  if (phase === "err" && !result) {
    return (
      <EmptyState
        title="Query failed"
        hint={error?.split("\n")[0] ?? ""}
        tone="error"
      />
    );
  }
  if (!result) return null;
  if (result.columns.length === 0) {
    return (
      <EmptyState
        title="Statement executed"
        hint={`${result.command ?? "OK"} · ${result.rowCount} row${
          result.rowCount === 1 ? "" : "s"
        } affected · ${result.durationMs}ms`}
        tone="ok"
      />
    );
  }
  const pageRows = rows.slice(offset, offset + pageSize);
  return (
    <div className="flex flex-col">
      <table className="w-full text-xs font-mono border-collapse">
        <thead className="bg-muted/60 sticky top-0 z-[1]">
          <tr>
            {result.columns.map((f) => (
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
          {pageRows.map((row, i) => (
            <tr
              key={offset + i}
              className="border-b border-border/30 hover:bg-foreground/[0.025]"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn("max-w-[40ch] truncate align-top", cellPad)}
                  title={cell == null ? "null" : String(cell)}
                >
                  {cell === null ? (
                    <span className="text-muted-foreground/50 italic">
                      null
                    </span>
                  ) : typeof cell === "object" ? (
                    <span className="text-brand">{JSON.stringify(cell)}</span>
                  ) : typeof cell === "boolean" ? (
                    <span className="text-brand">
                      {cell ? "true" : "false"}
                    </span>
                  ) : (
                    String(cell)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 0 ? (
        <div className="border-t border-border/40 px-3 py-2 bg-background sticky bottom-0">
          <DataPagination
            offset={offset}
            pageSize={pageSize}
            total={rows.length}
            onOffsetChange={setOffset}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setOffset(0);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MessagesPanel({
  phase,
  result,
  error,
  errors,
  sql,
}: {
  phase: "idle" | "running" | "ok" | "err";
  result: StatementResult | null;
  error: string | null;
  errors: StatementError[];
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
          [ok]{" "}
          {result.isCommand
            ? `${result.command ?? "OK"} · ${result.rowCount} row${
                result.rowCount === 1 ? "" : "s"
              } affected`
            : `returned ${result.rowCount} row${
                result.rowCount === 1 ? "" : "s"
              }`}{" "}
          in {result.durationMs}ms
          {result.truncated ? " · first 1000 rows (more exist)" : ""}
        </div>
      ) : null}
      {/* MySQL stops at the first error; surface each one it reported. */}
      {errors.map((e, i) => (
        <div key={i} className="space-y-0.5">
          <div className="text-muted-foreground/80">
            {e.statement.replace(/\s+/g, " ").slice(0, 140)}
            {e.statement.length > 140 ? "…" : ""}
          </div>
          <pre className="text-destructive whitespace-pre-wrap break-words">
            {e.error}
          </pre>
        </div>
      ))}
      {errors.length === 0 && phase === "err" && error ? (
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

function ExplainPanel({
  explain,
  loading,
  error,
  cellPad,
  headPad,
}: {
  explain: ExplainResponse | null;
  loading: boolean;
  error: string | null;
  cellPad: string;
  headPad: string;
}) {
  if (loading) {
    return (
      <EmptyState title="Running EXPLAIN…" hint="Analyzing the query plan." />
    );
  }
  if (error) {
    return (
      <EmptyState
        title="EXPLAIN failed"
        hint={error.split("\n")[0]}
        tone="error"
      />
    );
  }
  if (!explain) {
    return (
      <EmptyState
        title="No plan yet"
        hint="Run EXPLAIN (⌘E) to see the query plan."
      />
    );
  }
  if (explain.columns.length === 0) {
    return <EmptyState title="No plan rows" tone="ok" />;
  }
  return (
    <table className="w-full text-xs font-mono border-collapse">
      <thead className="bg-muted/60 sticky top-0 z-[1]">
        <tr>
          {explain.columns.map((f) => (
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
        {explain.rows.map((row, i) => (
          <tr
            key={i}
            className="border-b border-border/30 hover:bg-foreground/[0.025]"
          >
            {explain.columns.map((c, j) => {
              const cell = row[c] ?? null;
              return (
                <td
                  key={j}
                  className={cn("max-w-[40ch] truncate align-top", cellPad)}
                  title={cell == null ? "null" : String(cell)}
                >
                  {cell === null ? (
                    <span className="text-muted-foreground/50 italic">
                      null
                    </span>
                  ) : (
                    String(cell)
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
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
