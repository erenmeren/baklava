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
  kind: "out" | "in" | "system";
}

const PROMPT = "/ #";

function decode(b64: string): Uint8Array {
  if (typeof window !== "undefined" && typeof atob === "function") {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  return new Uint8Array();
}

function encode(text: string): string {
  if (typeof window !== "undefined" && typeof btoa === "function") {
    let binary = "";
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return "";
}

/**
 * Real interactive shell. Server-side opens a Kubernetes exec WS via
 * @kubernetes/client-node and exposes it as an SSE/POST session pair so we
 * can keep the websocket out of the browser. The overlay reads stdout/stderr
 * over EventSource and POSTs each line of stdin to /input.
 *
 * UX is a stripped-down terminal — line-buffered, not a full PTY emulator.
 * Most apps' /bin/sh works fine; programs that need raw mode (vim, top) will
 * misbehave, which matches the warning we surface in the header.
 */
export function ShellOverlay({
  connectionId,
  namespace,
  pod,
  containers = [],
  onClose,
}: Props) {
  const [container, setContainer] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([
    { id: 0, text: `connecting to ${namespace}/${pod}…`, kind: "system" },
  ]);
  const [cmd, setCmd] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "ended" | "error">(
    "connecting",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const idRef = useRef(1);
  const partialRef = useRef("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function appendSystem(text: string) {
    setLines((cur) => [
      ...cur,
      { id: idRef.current++, text, kind: "system" },
    ]);
  }

  function appendStream(chunk: string) {
    // Buffer until newline so partial writes don't make every keystroke a
    // separate row. Strip ANSI cursor-control noise that breaks the simple
    // line view (we keep color codes — they render through whitespace-pre-wrap
    // as visible escape sequences, which is preferable to garbled bytes).
    const combined = partialRef.current + chunk;
    const lines = combined.split(/\r?\n/);
    partialRef.current = lines.pop() ?? "";
    if (lines.length === 0) return;
    setLines((cur) => {
      const next = [...cur];
      for (const text of lines) {
        next.push({ id: idRef.current++, text: stripAnsiCursor(text), kind: "out" });
      }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const res = await fetch(
          `/api/kubernetes/${connectionId}/pods/${encodeURIComponent(
            namespace,
          )}/${encodeURIComponent(pod)}/exec`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              shell: "/bin/sh",
              ...(container ? { container } : {}),
            }),
          },
        );
        const data = (await res.json()) as { sessionId?: string; error?: string };
        if (!res.ok || !data.sessionId) {
          throw new Error(data.error || `exec start failed (${res.status})`);
        }
        if (cancelled) {
          // Race: component unmounted between request and response.
          fetch(`/api/kubernetes/${connectionId}/exec/${data.sessionId}`, {
            method: "DELETE",
          }).catch(() => {});
          return;
        }
        sessionRef.current = data.sessionId;
        setStatus("live");
        appendSystem(`attached · /bin/sh`);

        const es = new EventSource(
          `/api/kubernetes/${connectionId}/exec/${data.sessionId}/stream`,
        );
        sourceRef.current = es;
        es.addEventListener("data", (e) => {
          const raw = JSON.parse((e as MessageEvent).data) as string;
          const bytes = decode(raw);
          const text = new TextDecoder().decode(bytes);
          appendStream(text);
        });
        es.addEventListener("end", () => {
          setStatus("ended");
          appendSystem("session ended");
          es.close();
        });
        es.addEventListener("error", () => {
          if (status !== "ended") setStatus("error");
          es.close();
        });
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    }
    start();
    return () => {
      cancelled = true;
      sourceRef.current?.close();
      sourceRef.current = null;
      const sid = sessionRef.current;
      if (sid) {
        fetch(`/api/kubernetes/${connectionId}/exec/${sid}`, {
          method: "DELETE",
        }).catch(() => {});
        sessionRef.current = null;
      }
    };
    // Switching container tears the session down (cleanup above) and execs
    // into the new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, namespace, pod, container]);

  async function send(text: string) {
    const sid = sessionRef.current;
    if (!sid) return;
    await fetch(`/api/kubernetes/${connectionId}/exec/${sid}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: encode(text) }),
    }).catch(() => {});
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status !== "live") return;
    const text = cmd;
    if (text.trim()) {
      setHistory((h) => [...h, text]);
    }
    setLines((cur) => [
      ...cur,
      { id: idRef.current++, text: `${PROMPT} ${text}`, kind: "in" },
    ]);
    send(text + "\n");
    setCmd("");
    setHistIdx(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
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
      setLines([]);
    }
    if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      send("\x03"); // SIGINT
    }
    if (e.key === "d" && e.ctrlKey) {
      e.preventDefault();
      send("\x04"); // EOF
    }
  }

  const statusLabel: Record<typeof status, { label: string; color: string }> = {
    connecting: { label: "connecting", color: "text-amber-600 dark:text-amber-400" },
    live: { label: "attached", color: "text-emerald-600 dark:text-emerald-400" },
    ended: { label: "ended", color: "text-muted-foreground" },
    error: { label: "error", color: "text-red-600 dark:text-red-400" },
  };

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-background/55 backdrop-blur-[2px]"
        onMouseDown={onClose}
      />
      <div className="absolute inset-x-4 inset-y-8 lg:inset-x-16 lg:inset-y-12 bg-popover border border-border/70 rounded-lg shadow-2xl shadow-black/30 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30 font-mono gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300">
              shell
            </span>
            <span className="text-sm font-medium truncate">{namespace}/{pod}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[10px] ml-2",
                statusLabel[status].color,
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  status === "live"
                    ? "bg-emerald-500 status-pulse"
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
                setLines([
                  { id: 0, text: `connecting to ${namespace}/${pod} [${c}]…`, kind: "system" },
                ]);
              }}
            />
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
          onClick={() => inputRef.current?.focus()}
          className="flex-1 min-h-0 overflow-auto bg-zinc-950 text-zinc-200 font-mono text-[12px] leading-[1.55] px-4 py-3 cursor-text"
        >
          {status === "error" && errorMsg ? (
            <div className="text-red-400 mb-2 whitespace-pre-wrap break-words">
              {errorMsg}
            </div>
          ) : null}
          {lines.map((l) => (
            <div
              key={l.id}
              className={cn(
                "whitespace-pre-wrap break-words",
                l.kind === "system" && "text-zinc-500 italic",
                l.kind === "in" && "text-zinc-300",
                l.kind === "out" && "text-zinc-200",
              )}
            >
              {l.text}
            </div>
          ))}
          <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-0.5">
            <span className="text-emerald-400 shrink-0">{PROMPT}</span>
            <input
              ref={inputRef}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={status !== "live"}
              spellCheck={false}
              autoComplete="off"
              className="flex-1 bg-transparent outline-none text-zinc-100 caret-emerald-400 disabled:opacity-40"
            />
          </form>
        </div>
      </div>
    </div>
  );
}

function stripAnsiCursor(s: string): string {
  // Drop ANSI cursor-movement and clear-screen escapes. We keep color SGRs
  // (CSI ... m) so colored output renders sensibly through whitespace-pre-wrap.
  // The browser won't actually colorize them — but keeping them readable is
  // better than collapsing into garbled bytes.
  return s.replace(/\x1b\[[0-9;]*[A-HJKSTfsu]/g, "");
}
