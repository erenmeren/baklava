"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
}

interface Entry {
  id: number;
  cmd: string;
  result?: unknown;
  error?: string;
}

function tokenize(input: string): string[] {
  // Minimal shell-style tokenizer with single + double quotes.
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) {
        quote = null;
        continue;
      }
      if (c === "\\" && i + 1 < input.length) {
        cur += input[++i];
        continue;
      }
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c as '"' | "'";
    } else if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function formatReply(reply: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (reply === null) return `${pad}(nil)`;
  if (typeof reply === "string") return `${pad}"${reply}"`;
  if (typeof reply === "number") return `${pad}(integer) ${reply}`;
  if (Array.isArray(reply)) {
    if (reply.length === 0) return `${pad}(empty list or set)`;
    return reply
      .map((r, i) => `${pad}${i + 1}) ${formatReply(r, 0).trim()}`)
      .join("\n");
  }
  return `${pad}${JSON.stringify(reply)}`;
}

export function CliClient({ connectionId }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cmd, setCmd] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = cmd.trim();
    if (!trimmed) return;
    const args = tokenize(trimmed);
    const id = idRef.current++;
    setEntries((cur) => [...cur, { id, cmd: trimmed }]);
    setHistory((h) => [...h, trimmed]);
    setHistIdx(null);
    setCmd("");
    try {
      const res = await fetch(`/api/redis/${connectionId}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args }),
      });
      const data = await res.json();
      setEntries((cur) =>
        cur.map((entry) =>
          entry.id === id
            ? data.ok
              ? { ...entry, result: data.reply }
              : { ...entry, error: data.error || `failed (${res.status})` }
            : entry,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEntries((cur) =>
        cur.map((entry) =>
          entry.id === id ? { ...entry, error: msg } : entry,
        ),
      );
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setCmd(history[next] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === null) return;
      const next = histIdx + 1;
      if (next >= history.length) {
        setHistIdx(null);
        setCmd("");
      } else {
        setHistIdx(next);
        setCmd(history[next] ?? "");
      }
      return;
    }
    if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setEntries([]);
    }
  }

  return (
    <WorkspacePage
      title="CLI"
      description="Send raw Redis commands. Use Up/Down for history, Ctrl/Cmd+L to clear. MONITOR / SUBSCRIBE are routed to the dedicated panels."
    >
      <div className="h-full min-h-0 flex flex-col rounded-md border border-border/60 overflow-hidden bg-zinc-950 text-zinc-100">
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-auto font-mono text-[12.5px] leading-[1.55] px-4 py-3"
          onClick={() => inputRef.current?.focus()}
        >
          {entries.length === 0 ? (
            <div className="text-zinc-500 italic">
              type a command and press enter — e.g. <span className="text-zinc-300">INFO server</span>
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="mb-3">
                <div className="text-emerald-400">
                  <span className="text-zinc-500">redis&gt;</span> {entry.cmd}
                </div>
                {entry.error ? (
                  <div className="text-red-400 whitespace-pre-wrap">
                    (error) {entry.error}
                  </div>
                ) : entry.result !== undefined ? (
                  <pre className="text-zinc-200 whitespace-pre-wrap break-words">
                    {formatReply(entry.result)}
                  </pre>
                ) : (
                  <div className="text-zinc-500 italic">…</div>
                )}
              </div>
            ))
          )}
        </div>
        <form onSubmit={submit} className="border-t border-border/40 px-4 py-2 flex items-center gap-2 bg-zinc-900/60">
          <span className="text-emerald-400 font-mono text-sm shrink-0">redis&gt;</span>
          <input
            ref={inputRef}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={handleKey}
            spellCheck={false}
            autoComplete="off"
            className={cn(
              "flex-1 bg-transparent outline-none text-zinc-100",
              "font-mono text-sm caret-emerald-400",
            )}
          />
        </form>
      </div>
    </WorkspacePage>
  );
}
