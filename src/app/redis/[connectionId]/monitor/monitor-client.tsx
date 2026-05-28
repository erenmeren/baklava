"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Square, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
}

interface Line {
  id: number;
  time: string;
  args: string[];
  source: string;
  db: string;
}

const MAX = 2000;

export function MonitorClient({ connectionId }: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [grep, setGrep] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && running) el.scrollTop = el.scrollHeight;
  }, [lines, running]);

  function start() {
    if (running) return;
    setStatus("connecting");
    setErrorMsg(null);
    const es = new EventSource(`/api/redis/${connectionId}/monitor`);
    sourceRef.current = es;
    setRunning(true);
    es.addEventListener("monitor", (e) => {
      const payload = JSON.parse((e as MessageEvent).data) as {
        time: string;
        args: string[];
        source: string;
        db: string;
      };
      setStatus("live");
      setLines((cur) => {
        const next = cur.slice(-(MAX - 1));
        next.push({
          id: idRef.current++,
          time: payload.time,
          args: payload.args,
          source: payload.source,
          db: payload.db,
        });
        return next;
      });
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
      stop();
    });
  }

  function stop() {
    sourceRef.current?.close();
    sourceRef.current = null;
    setRunning(false);
  }

  const filtered = grep
    ? lines.filter((l) =>
        l.args.join(" ").toLowerCase().includes(grep.toLowerCase()),
      )
    : lines;

  return (
    <WorkspacePage
      title="MONITOR"
      description="Live stream of every command the server processes. Heavy on production traffic — use sparingly."
      actions={
        <>
          <Input
            value={grep}
            onChange={(e) => setGrep(e.target.value)}
            placeholder="grep…"
            className="w-44 h-9 font-mono text-xs"
          />
          {running ? (
            <Button variant="outline" size="sm" onClick={stop}>
              <Square className="size-4" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={start}>
              <Play className="size-4" /> Start
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setLines([])}>
            <Trash2 className="size-4" /> Clear
          </Button>
        </>
      }
    >
      <div className="h-full min-h-0 flex flex-col rounded-md border border-border/60 overflow-hidden bg-zinc-950 text-zinc-200">
        <div className="px-3 py-1.5 border-b border-border/60 flex items-center justify-between text-[10px] font-mono">
          <span className="text-zinc-400">
            <span
              className={cn(
                "size-1.5 rounded-full inline-block mr-1.5",
                status === "live"
                  ? "bg-emerald-500 status-pulse"
                  : status === "error"
                    ? "bg-red-500"
                    : status === "connecting"
                      ? "bg-amber-500"
                      : "bg-zinc-500",
              )}
            />
            {status}
          </span>
          <span className="text-zinc-500">
            <span className="text-zinc-300 tabular-nums">{filtered.length}</span>
            /{lines.length} commands
          </span>
        </div>
        {errorMsg ? (
          <div className="px-4 py-2 text-red-400 text-xs border-b border-red-500/30 bg-red-500/5">
            {errorMsg}
          </div>
        ) : null}
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-auto font-mono text-[11.5px] leading-[1.55]"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-zinc-500">
              {running ? "waiting for commands…" : "press Start to begin MONITOR"}
            </div>
          ) : (
            filtered.map((l) => (
              <div key={l.id} className="px-4 py-0.5 flex gap-3 hover:bg-white/[0.03]">
                <span className="text-zinc-500 tabular-nums shrink-0 w-28">
                  {l.time.split(".")[0]}
                </span>
                <span className="text-zinc-500 tabular-nums shrink-0 w-12 text-right">
                  [{l.db}]
                </span>
                <span className="text-zinc-500 shrink-0 w-28 truncate" title={l.source}>
                  {l.source}
                </span>
                <span className="flex-1 min-w-0 whitespace-pre-wrap break-words">
                  <span className="text-emerald-400">{l.args[0]}</span>
                  {l.args.length > 1 ? " " + l.args.slice(1).join(" ") : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </WorkspacePage>
  );
}
