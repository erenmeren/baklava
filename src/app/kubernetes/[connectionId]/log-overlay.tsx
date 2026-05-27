"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  target: string;
  onClose: () => void;
}

const LEVELS = ["INFO", "INFO", "INFO", "DEBUG", "WARN", "INFO", "ERROR"] as const;
const PHRASES = [
  "incoming request method=GET path=/healthz",
  "processed 142 events in 18ms",
  "connection accepted from 10.244.2.34",
  "cache hit ratio=0.91",
  "renewed lease ttl=15s",
  "outgoing call upstream=ledger status=200",
  "rate limit close threshold ratio=0.78",
  "queue depth=12 lag=4ms",
  "metrics flushed",
  "config reload triggered",
];

function level(): (typeof LEVELS)[number] {
  return LEVELS[Math.floor(Math.random() * LEVELS.length)];
}

function phrase(): string {
  return PHRASES[Math.floor(Math.random() * PHRASES.length)];
}

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Mock log stream. Pumps a new line every ~280ms, supports follow / pause,
 * grep filter, and clear. Mirrors `kubectl logs -f` aesthetics.
 */
export function LogOverlay({ target, onClose }: Props) {
  const [lines, setLines] = useState<
    { ts: string; level: string; msg: string }[]
  >([]);
  const [follow, setFollow] = useState(true);
  const [grep, setGrep] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Seed
  useEffect(() => {
    const seed: { ts: string; level: string; msg: string }[] = [];
    for (let i = 0; i < 14; i++) {
      seed.push({ ts: ts(), level: level(), msg: phrase() });
    }
    setLines(seed);
  }, []);

  // Stream
  useEffect(() => {
    if (!follow) return;
    const id = setInterval(() => {
      setLines((cur) => [
        ...cur.slice(-300),
        { ts: ts(), level: level(), msg: phrase() },
      ]);
    }, 280);
    return () => clearInterval(id);
  }, [follow]);

  // Auto-scroll on new lines.
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  const filtered = grep
    ? lines.filter((l) =>
        (l.msg + " " + l.level).toLowerCase().includes(grep.toLowerCase()),
      )
    : lines;

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-background/55 backdrop-blur-[2px]"
        onMouseDown={onClose}
      />
      <div className="absolute inset-x-4 inset-y-8 lg:inset-x-16 lg:inset-y-12 bg-popover border border-border/70 rounded-lg shadow-2xl shadow-black/30 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30 font-mono gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              logs
            </span>
            <span className="text-sm font-medium truncate">{target}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[10px] ml-2",
                follow ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  follow ? "bg-emerald-500 status-pulse" : "bg-muted-foreground",
                )}
              />
              {follow ? "following" : "paused"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex items-center gap-1.5 rounded border border-border/60 px-2 py-1 bg-background/60">
              <span className="text-muted-foreground text-[10px]">grep</span>
              <input
                value={grep}
                onChange={(e) => setGrep(e.target.value)}
                placeholder="filter…"
                className="bg-transparent outline-none text-xs w-32 placeholder:text-muted-foreground/60"
                autoComplete="off"
              />
            </div>
            <button
              onClick={() => setFollow((f) => !f)}
              className="rounded border border-border/60 px-2 py-1 text-xs hover:bg-foreground/5"
            >
              {follow ? "pause" : "follow"}
            </button>
            <button
              onClick={() => setLines([])}
              className="rounded border border-border/60 px-2 py-1 text-xs hover:bg-foreground/5"
            >
              clear
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              esc to close
            </button>
          </div>
        </div>
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-auto bg-zinc-950 text-zinc-200 font-mono text-[11.5px] leading-[1.55]"
        >
          {filtered.map((l, i) => (
            <div key={i} className="px-4 py-px flex gap-3 hover:bg-white/[0.03]">
              <span className="text-zinc-500 tabular-nums shrink-0">
                {l.ts}
              </span>
              <span
                className={cn(
                  "shrink-0 w-12",
                  l.level === "ERROR"
                    ? "text-red-400"
                    : l.level === "WARN"
                      ? "text-amber-400"
                      : l.level === "DEBUG"
                        ? "text-zinc-500"
                        : "text-emerald-400",
                )}
              >
                {l.level}
              </span>
              <span className="flex-1 min-w-0 whitespace-pre-wrap break-words">
                {l.msg}
              </span>
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-zinc-500">
              no log lines match{" "}
              <span className="text-zinc-300">&apos;{grep}&apos;</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
