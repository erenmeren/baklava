"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowDownToLine,
  Clock,
  Download,
  Eraser,
  Pause,
  Play,
  RefreshCcw,
  Search,
  TerminalSquare,
} from "lucide-react";

interface Props {
  connectionId: string;
  cid: string;
  active: boolean;
  onOpenTerminal?: () => void;
}

type Status = "connecting" | "streaming" | "paused" | "disconnected" | "error";
type Tail = 100 | 500 | 2000 | 10000 | "all";
type Since = "" | "60" | "300" | "3600";

interface LogEntry {
  channel: "stdout" | "stderr";
  text: string;
}

const TAIL_OPTIONS: { value: Tail; label: string }[] = [
  { value: 100, label: "100" },
  { value: 500, label: "500" },
  { value: 2000, label: "2k" },
  { value: 10000, label: "10k" },
  { value: "all", label: "All" },
];

const SINCE_OPTIONS: { value: Since; label: string }[] = [
  { value: "", label: "Any time" },
  { value: "60", label: "Last 1m" },
  { value: "300", label: "Last 5m" },
  { value: "3600", label: "Last 1h" },
];

const BUFFER_CAP = 5000;
const ANSI_DIM = "\x1b[2m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_HIGHLIGHT = "\x1b[43m\x1b[30m";

const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s/;

function Divider() {
  return <span className="border-l border-border/40 h-4 mx-1" aria-hidden />;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatLine(entry: LogEntry, search: string): string {
  let body = entry.text;
  const m = TIMESTAMP_RE.exec(body);
  let prefix = "";
  if (m) {
    prefix = `${ANSI_DIM}${m[1]}${ANSI_RESET} `;
    body = body.slice(m[0].length);
  }
  if (search && search.length > 0) {
    try {
      const re = new RegExp(escapeRegex(search), "gi");
      body = body.replace(re, (match) => `${ANSI_HIGHLIGHT}${match}${ANSI_RESET}`);
    } catch {
      // ignore invalid pattern
    }
  }
  const colored = entry.channel === "stderr" ? `${ANSI_RED}${body}${ANSI_RESET}` : body;
  return `${prefix}${colored}`;
}

export function LogsTab({ connectionId, cid, active, onOpenTerminal }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{
    term: import("@xterm/xterm").Terminal;
    fit: import("@xterm/addon-fit").FitAddon;
  } | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const bufferRef = useRef<LogEntry[]>([]);
  const followRef = useRef(true);
  const searchRef = useRef("");

  const [paused, setPaused] = useState(false);
  const [tail, setTail] = useState<Tail>(2000);
  const [since, setSince] = useState<Since>("");
  const [timestamps, setTimestamps] = useState(false);
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(true);
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [matchCount, setMatchCount] = useState(0);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  const writeEntry = useCallback((entry: LogEntry) => {
    const term = termRef.current?.term;
    if (!term) return;
    term.writeln(formatLine(entry, searchRef.current));
    if (followRef.current) {
      term.scrollToBottom();
    }
  }, []);

  const replayBuffer = useCallback(() => {
    const term = termRef.current?.term;
    if (!term) return;
    term.clear();
    const searchValue = searchRef.current;
    let count = 0;
    for (const entry of bufferRef.current) {
      term.writeln(formatLine(entry, searchValue));
      if (searchValue && entry.text.toLowerCase().includes(searchValue.toLowerCase())) {
        count++;
      }
    }
    if (followRef.current) {
      term.scrollToBottom();
    }
    setMatchCount(searchValue ? count : 0);
  }, []);

  // Mount xterm once when first active
  useEffect(() => {
    if (!active) return;
    if (termRef.current || !containerRef.current) return;
    let cancelled = false;

    const onResize = () => {
      try {
        termRef.current?.fit.fit();
      } catch {
        // ignore
      }
    };
    window.addEventListener("resize", onResize);

    (async () => {
      if (typeof document !== "undefined" && !document.getElementById("xterm-css")) {
        const link = document.createElement("link");
        link.id = "xterm-css";
        link.rel = "stylesheet";
        link.href = "/xterm.css";
        document.head.appendChild(link);
      }
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (cancelled || !containerRef.current) return;
      const term = new Terminal({
        fontFamily:
          'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace',
        fontSize: 12,
        cursorBlink: false,
        disableStdin: true,
        scrollback: 10000,
        convertEol: true,
        theme: {
          background: "#0a0a0c",
          foreground: "#f5f5f4",
          red: "#fb7185",
          yellow: "#f4b528",
          selectionBackground: "#f4b52866",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      try {
        fit.fit();
      } catch {
        // ignore
      }
      termRef.current = { term, fit };

      // Detect user scroll → exit follow mode
      term.onScroll(() => {
        const viewportY = term.buffer.active.viewportY;
        const baseY = term.buffer.active.baseY;
        const atBottom = viewportY >= baseY;
        if (!atBottom && followRef.current) {
          setFollow(false);
        }
      });
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [active]);

  // Re-fit when active flips on
  useEffect(() => {
    if (active && termRef.current) {
      try {
        termRef.current.fit.fit();
      } catch {
        // ignore
      }
    }
  }, [active]);

  // Open EventSource. Re-runs when tail/since/timestamps change or pause toggles.
  useEffect(() => {
    if (!active) return;
    if (paused) {
      sourceRef.current?.close();
      sourceRef.current = null;
      setStatus("paused");
      return;
    }

    setStatus("connecting");
    setErrorMessage(null);
    bufferRef.current = [];
    const term = termRef.current?.term;
    term?.clear();

    const params = new URLSearchParams({
      tail: String(tail),
      timestamps: timestamps ? "1" : "0",
    });
    if (since) {
      const sec = Math.floor(Date.now() / 1000) - Number(since);
      params.set("since", String(sec));
    }
    const url = `/api/docker/${connectionId}/containers/${cid}/logs/stream?${params.toString()}`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.addEventListener("ready", () => {
      setStatus("streaming");
    });
    es.addEventListener("line", (ev) => {
      try {
        const entry = JSON.parse((ev as MessageEvent).data) as LogEntry;
        bufferRef.current.push(entry);
        if (bufferRef.current.length > BUFFER_CAP) {
          bufferRef.current.splice(0, bufferRef.current.length - BUFFER_CAP);
        }
        if (searchRef.current && entry.text.toLowerCase().includes(searchRef.current.toLowerCase())) {
          setMatchCount((c) => c + 1);
        }
        writeEntry(entry);
      } catch {
        // ignore malformed
      }
    });
    es.addEventListener("error", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data ?? "{}") as {
          message?: string;
        };
        if (data.message) setErrorMessage(data.message);
      } catch {
        // generic network error event has no payload
      }
      setStatus("error");
    });
    es.addEventListener("end", () => {
      setStatus("disconnected");
    });
    es.onerror = () => {
      // Browsers fire onerror on network drops; if SSE was streaming, mark error.
      // EventSource will auto-reconnect, so don't close it here.
      setStatus((prev) => (prev === "streaming" ? "error" : prev));
    };

    return () => {
      es.close();
      if (sourceRef.current === es) sourceRef.current = null;
    };
  }, [active, paused, tail, since, timestamps, connectionId, cid, writeEntry]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
      termRef.current?.term.dispose();
      termRef.current = null;
    };
  }, []);

  // When search changes, replay buffer to highlight matches.
  useEffect(() => {
    if (!termRef.current) return;
    replayBuffer();
  }, [search, replayBuffer]);

  const reconnect = () => {
    // Force the open-stream effect to re-run by briefly pausing then unpausing.
    sourceRef.current?.close();
    sourceRef.current = null;
    setStatus("connecting");
    setErrorMessage(null);
    // Bumping a state value is cleaner than reaching into refs; toggle pause off→off
    // We rely on react to re-run the open effect when paused stays false but status changes.
    // To force a re-open, briefly toggle pause.
    setPaused(true);
    setTimeout(() => setPaused(false), 16);
  };

  const downloadUrl = useMemo(() => {
    const params = new URLSearchParams({
      download: "1",
      tail: "all",
      timestamps: timestamps ? "1" : "0",
    });
    return `/api/docker/${connectionId}/containers/${cid}/logs?${params.toString()}`;
  }, [connectionId, cid, timestamps]);

  const statusPill = useMemo(() => {
    const tone =
      status === "streaming"
        ? { dot: "bg-emerald-500 status-pulse", label: "STREAMING" }
        : status === "paused"
          ? { dot: "bg-amber-500", label: "PAUSED" }
          : status === "connecting"
            ? { dot: "bg-sky-500 status-pulse", label: "CONNECTING" }
            : status === "disconnected"
              ? { dot: "bg-zinc-500", label: "DISCONNECTED" }
              : { dot: "bg-rose-500", label: "ERROR" };
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider">
        <span className={cn("size-1.5 rounded-full", tone.dot)} />
        {tone.label}
        {(status === "disconnected" || status === "error") && (
          <button
            type="button"
            onClick={reconnect}
            className="ml-1 text-foreground/70 hover:text-foreground underline-offset-2 hover:underline"
          >
            reconnect
          </button>
        )}
      </span>
    );
  }, [status]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5">
        {statusPill}
        <Divider />
        <Button
          size="xs"
          variant={paused ? "default" : "outline"}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            termRef.current?.term.clear();
            bufferRef.current = [];
            setMatchCount(0);
          }}
        >
          <Eraser className="size-3" />
          Clear
        </Button>
        <Divider />
        <label className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Tail
          <select
            value={String(tail)}
            onChange={(e) => {
              const v = e.target.value;
              setTail(v === "all" ? "all" : (Number(v) as Tail));
            }}
            className="h-6 rounded-md border border-input bg-transparent px-1.5 text-xs font-mono shadow-xs"
          >
            {TAIL_OPTIONS.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <Clock className="size-3" />
          <select
            value={since}
            onChange={(e) => setSince(e.target.value as Since)}
            className="h-6 rounded-md border border-input bg-transparent px-1.5 text-xs font-mono shadow-xs"
          >
            {SINCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="xs"
          variant={timestamps ? "default" : "outline"}
          onClick={() => setTimestamps((t) => !t)}
        >
          ts
        </Button>
        <Divider />
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            spellCheck={false}
            className="h-6 pl-7 pr-12 text-xs font-mono"
          />
          {search ? (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground tabular-nums">
              {matchCount}
            </span>
          ) : null}
        </div>
        <Divider />
        <Link
          href={downloadUrl}
          className={cn(buttonVariants({ variant: "outline", size: "xs" }))}
          download
        >
          <Download className="size-3" />
          Download
        </Link>
        {onOpenTerminal ? (
          <Button size="xs" variant="ghost" onClick={onOpenTerminal}>
            <TerminalSquare className="size-3" />
            Terminal
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          onClick={reconnect}
          title="Reload from server"
        >
          <RefreshCcw className="size-3" />
        </Button>
      </div>

      {errorMessage ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-mono text-destructive break-words">
          {errorMessage}
        </div>
      ) : null}

      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          className="absolute inset-0 rounded-lg border border-border/60 bg-[#0a0a0c] p-2 overflow-hidden"
        />
        {!follow ? (
          <button
            type="button"
            onClick={() => {
              setFollow(true);
              termRef.current?.term.scrollToBottom();
            }}
            className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/95 px-3 py-1 text-xs font-mono shadow-lg hover:bg-card backdrop-blur"
          >
            <ArrowDownToLine className="size-3" />
            Jump to bottom
          </button>
        ) : null}
      </div>
    </div>
  );
}
