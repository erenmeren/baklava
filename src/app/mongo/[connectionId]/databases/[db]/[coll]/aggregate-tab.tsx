"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Trash2 } from "lucide-react";

interface Props {
  connectionId: string;
  dbName: string;
  collName: string;
}

const SAMPLE = `[
  { "$match": { } },
  { "$group": { "_id": "$status", "count": { "$sum": 1 } } },
  { "$sort": { "count": -1 } },
  { "$limit": 20 }
]`;

interface Result {
  documents: string[];
  truncated: boolean;
}

export function AggregateTab({ connectionId, dbName, collName }: Props) {
  const [pipeline, setPipeline] = useState(SAMPLE);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const url = `/api/mongo/${connectionId}/databases/${encodeURIComponent(
    dbName,
  )}/collections/${encodeURIComponent(collName)}/aggregate`;

  let validJson = true;
  try {
    const parsed = JSON.parse(pipeline);
    if (!Array.isArray(parsed)) validJson = false;
  } catch {
    validJson = false;
  }

  async function run() {
    if (!validJson) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipeline }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 min-h-[500px]">
      <div className="flex flex-col gap-3 min-h-0">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground font-mono">
            Pipeline — JSON array of stages
            {!validJson ? (
              <span className="ml-2 text-red-500">syntax error</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPipeline(SAMPLE)}>
              <Trash2 className="size-3" /> Reset
            </Button>
            <Button size="sm" onClick={run} disabled={!validJson || loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Run
            </Button>
          </div>
        </div>
        <textarea
          value={pipeline}
          onChange={(e) => setPipeline(e.target.value)}
          spellCheck={false}
          className="flex-1 min-h-[400px] bg-zinc-950 text-zinc-100 font-mono text-[12.5px] leading-[1.6] p-4 outline-none resize-none rounded-md border border-border/60 caret-emerald-400"
        />
      </div>

      <div className="flex flex-col gap-3 min-h-0">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground font-mono">
            {result
              ? `${result.documents.length} document(s)${result.truncated ? " · truncated at 500" : ""}`
              : "results"}
          </div>
        </div>
        {error ? (
          <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2 whitespace-pre-wrap break-words">
            {error}
          </div>
        ) : null}
        <div className="grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 flex-1 min-h-0">
          <div className="border border-border/60 rounded-md overflow-hidden bg-popover flex flex-col min-h-0">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/60 bg-muted/30">
              documents
            </div>
            <div className="flex-1 min-h-0 overflow-auto font-mono text-xs">
              {result?.documents.length === 0 ? (
                <div className="px-4 py-12 text-center text-muted-foreground">
                  no results
                </div>
              ) : (
                result?.documents.map((doc, i) => {
                  let summary = "";
                  try {
                    summary = JSON.stringify(JSON.parse(doc)).slice(0, 80);
                  } catch {
                    summary = doc.slice(0, 80);
                  }
                  return (
                    <button
                      key={i}
                      onClick={() => setSelected(i)}
                      className={
                        selected === i
                          ? "w-full text-left px-3 py-1.5 border-l-2 border-emerald-500 bg-emerald-500/8"
                          : "w-full text-left px-3 py-1.5 border-l-2 border-transparent hover:bg-foreground/[0.03]"
                      }
                    >
                      <span className="text-muted-foreground mr-2 tabular-nums">
                        {i + 1}
                      </span>
                      {summary}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div className="border border-border/60 rounded-md overflow-hidden bg-zinc-950 flex flex-col min-h-0">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/60 bg-zinc-900/60">
              preview
            </div>
            <pre className="flex-1 min-h-0 overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words">
              {selected !== null && result
                ? (() => {
                    try {
                      return JSON.stringify(JSON.parse(result.documents[selected]), null, 2);
                    } catch {
                      return result.documents[selected];
                    }
                  })()
                : <span className="text-zinc-500 italic">select a result</span>}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
