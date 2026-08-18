"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ContainerPicker } from "./container-picker";

interface Props {
  connectionId: string;
  namespace: string;
  pod: string;
  /** Container names on the pod; a picker appears when there's more than one. */
  containers?: string[];
  onClose: () => void;
}

interface Line {
  id: number;
  text: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG" | "RAW";
}

function inferLevel(text: string): Line["level"] {
  // Heuristic — most app logs prefix the level; we just colorize so the
  // overlay reads at a glance like k9s.
  const upper = text.slice(0, 80).toUpperCase();
  if (upper.includes("ERROR") || upper.includes("FATAL")) return "ERROR";
  if (upper.includes("WARN")) return "WARN";
  if (upper.includes("DEBUG") || upper.includes("TRACE")) return "DEBUG";
  if (upper.includes("INFO")) return "INFO";
  return "RAW";
}

const MAX_LINES = 1000;

/**
 * Real log stream. Subscribes to /api/kubernetes/[id]/pods/[ns]/[name]/logs
 * over SSE — server pumps `line` events (one per kubectl log line) and a
 * final `end` event when the stream closes. Follow / pause / grep / clear /
 * download all mirror `kubectl logs -f` ergonomics.
 */
export function LogOverlay({
  connectionId,
  namespace,
  pod,
  containers = [],
  onClose,
}: Props) {
  const [container, setContainer] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [follow, setFollow] = useState(true);
  const [grep, setGrep] = useState("");
  const [status, setStatus] = useState<"connecting" | "live" | "ended" | "error">(
    "connecting",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const sourceRef = useRef<EventSource | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Switching container re-subscribes: the previous EventSource is closed by
    // this effect's own cleanup before the new one opens.
    const ctr = container ? `&container=${encodeURIComponent(container)}` : "";
    const url = `/api/kubernetes/${connectionId}/pods/${encodeURIComponent(
      namespace,
    )}/${encodeURIComponent(pod)}/logs?tailLines=200${ctr}`;
    const es = new EventSource(url);
    sourceRef.current = es;
    es.addEventListener("line", (e) => {
      const payload = JSON.parse((e as MessageEvent).data) as { text: string };
      setStatus("live");
      setLines((cur) => {
        const next = cur.slice(-(MAX_LINES - 1));
        next.push({
          id: idRef.current++,
          text: payload.text,
          level: inferLevel(payload.text),
        });
        return next;
      });
    });
    es.addEventListener("end", () => {
      setStatus("ended");
      es.close();
    });
    es.addEventListener("error", (e) => {
      const msgEvent = e as MessageEvent;
      if (msgEvent.data) {
        try {
          const { message } = JSON.parse(msgEvent.data) as { message?: string };
          if (message) setErrorMsg(message);
        } catch {
          // ignore
        }
      }
      setStatus("error");
      es.close();
    });
    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [connectionId, namespace, pod, container]);

  useEffect(() => {
    if (!followRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  const filtered = grep
    ? lines.filter((l) => l.text.toLowerCase().includes(grep.toLowerCase()))
    : lines;

  const target = `${namespace}/${pod}`;
  const statusLabel: Record<typeof status, { label: string; color: string }> = {
    connecting: { label: "connecting", color: "text-amber-600 dark:text-amber-400" },
    live: { label: follow ? "following" : "paused", color: follow ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground" },
    ended: { label: "ended", color: "text-muted-foreground" },
    error: { label: "error", color: "text-red-600 dark:text-red-400" },
  };

  function download() {
    const text = lines.map((l) => l.text).join("\n") + "\n";
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pod}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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
                statusLabel[status].color,
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  status === "live" && follow
                    ? "bg-emerald-500 status-pulse"
                    : status === "live"
                      ? "bg-muted-foreground"
                      : status === "error"
                        ? "bg-red-500"
                        : "bg-amber-500",
                )}
              />
              {statusLabel[status].label}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ContainerPicker
              containers={containers}
              value={container}
              onChange={(c) => {
                setContainer(c);
                setLines([]);
              }}
            />
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
              onClick={download}
              className="rounded border border-border/60 px-2 py-1 text-xs hover:bg-foreground/5"
            >
              download
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
          {status === "error" && errorMsg ? (
            <div className="px-4 py-3 text-red-400 border-b border-red-500/30 bg-red-500/5 whitespace-pre-wrap">
              {errorMsg}
            </div>
          ) : null}
          {filtered.map((l) => (
            <div key={l.id} className="px-4 py-px flex gap-3 hover:bg-white/[0.03]">
              <span
                className={cn(
                  "shrink-0 w-12 uppercase tracking-[0.1em] text-[10px]",
                  l.level === "ERROR"
                    ? "text-red-400"
                    : l.level === "WARN"
                      ? "text-amber-400"
                      : l.level === "DEBUG"
                        ? "text-zinc-500"
                        : l.level === "INFO"
                          ? "text-emerald-400"
                          : "text-zinc-600",
                )}
              >
                {l.level === "RAW" ? "" : l.level}
              </span>
              <span className="flex-1 min-w-0 whitespace-pre-wrap break-words">
                {l.text}
              </span>
            </div>
          ))}
          {filtered.length === 0 && status !== "error" ? (
            <div className="px-4 py-12 text-center text-zinc-500">
              {status === "connecting"
                ? "waiting for first line…"
                : grep
                  ? <>no log lines match <span className="text-zinc-300">&apos;{grep}&apos;</span></>
                  : "no log lines yet"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
