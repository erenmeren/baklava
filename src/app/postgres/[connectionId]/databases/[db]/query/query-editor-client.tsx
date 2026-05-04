"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { Loader2, Play } from "lucide-react";

interface QueryResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

interface Props {
  connectionId: string;
  db: string;
}

export function QueryEditorClient({ connectionId, db }: Props) {
  const [sql, setSql] = useState(
    `-- ${db}\nselect now() as now, current_user as user;`
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<
    { sql: string; rowCount: number; durationMs: number }[]
  >([]);

  const execute = async () => {
    if (!sql.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/query`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sql }),
        }
      );
      const data = await res.json();
      if (res.ok && !data.error) {
        setResult(data as QueryResult);
        setHistory((h) =>
          [
            {
              sql,
              rowCount: data.rowCount,
              durationMs: data.durationMs,
            },
            ...h,
          ].slice(0, 20)
        );
      } else {
        setError(data.error || "Query failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      execute();
    }
  };

  return (
    <WorkspacePage
      title={
        <span>
          SQL editor <span className="font-mono text-base">· {db}</span>
        </span>
      }
      description="Cmd/Ctrl+Enter to run. Results capped at 500 rows."
      actions={
        <Button onClick={execute} disabled={running || !sql.trim()}>
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run
        </Button>
      }
    >
      <div className="grid grid-rows-[auto_1fr] h-full gap-4">
        <Textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKey}
          rows={8}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <div className="min-h-0 overflow-auto space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Query failed</AlertTitle>
              <AlertDescription className="font-mono text-xs break-words">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <>
              <p className="text-xs text-muted-foreground">
                {result.rowCount.toLocaleString()} row(s) ·{" "}
                {result.durationMs}ms
                {result.truncated ? " · truncated to 500" : ""}
              </p>
              {result.fields.length > 0 ? (
                <div className="rounded-lg border border-border/60 overflow-auto max-h-[55vh]">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr>
                        {result.fields.map((f) => (
                          <th
                            key={f}
                            className="px-3 py-2 text-left font-semibold border-b border-border/60 whitespace-nowrap"
                          >
                            {f}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className="border-b border-border/30">
                          {row.map((cell, j) => (
                            <td
                              key={j}
                              className="px-3 py-1.5 max-w-[40ch] truncate align-top"
                              title={cell == null ? "null" : String(cell)}
                            >
                              {cell === null ? (
                                <span className="text-muted-foreground/50 italic">
                                  null
                                </span>
                              ) : typeof cell === "object" ? (
                                JSON.stringify(cell)
                              ) : (
                                String(cell)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Statement executed.
                </p>
              )}
            </>
          ) : null}

          {!result && !error ? (
            history.length ? (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  History
                </h3>
                <ul className="space-y-1">
                  {history.map((h, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-border/40 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {h.rowCount} rows · {h.durationMs}ms
                        </span>
                        <button
                          className="text-foreground hover:underline"
                          onClick={() => setSql(h.sql)}
                        >
                          Load
                        </button>
                      </div>
                      <pre className="font-mono text-[11px] mt-1 truncate text-muted-foreground">
                        {h.sql.split("\n")[0]}
                      </pre>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          ) : null}
        </div>
      </div>
    </WorkspacePage>
  );
}
