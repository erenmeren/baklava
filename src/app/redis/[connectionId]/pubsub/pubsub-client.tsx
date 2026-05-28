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

interface Message {
  id: number;
  time: number;
  channel: string;
  pattern?: string;
  message: string;
}

const MAX = 2000;

export function PubSubClient({ connectionId }: Props) {
  const [channels, setChannels] = useState("");
  const [patterns, setPatterns] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
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
  }, [messages, running]);

  function start() {
    if (running) return;
    const channelList = channels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const patternList = patterns
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (channelList.length === 0 && patternList.length === 0) {
      setErrorMsg("Provide at least one channel or pattern");
      setStatus("error");
      return;
    }
    setStatus("connecting");
    setErrorMsg(null);
    const params = new URLSearchParams();
    for (const c of channelList) params.append("channel", c);
    for (const p of patternList) params.append("pattern", p);
    const es = new EventSource(
      `/api/redis/${connectionId}/pubsub?${params.toString()}`,
    );
    sourceRef.current = es;
    setRunning(true);
    const onMessage = (kind: "message" | "pmessage") => (e: Event) => {
      const payload = JSON.parse((e as MessageEvent).data) as {
        channel: string;
        pattern?: string;
        message: string;
      };
      setStatus("live");
      setMessages((cur) => {
        const next = cur.slice(-(MAX - 1));
        next.push({
          id: idRef.current++,
          time: Date.now(),
          channel: payload.channel,
          pattern: kind === "pmessage" ? payload.pattern : undefined,
          message: payload.message,
        });
        return next;
      });
    };
    es.addEventListener("message", onMessage("message"));
    es.addEventListener("pmessage", onMessage("pmessage"));
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

  return (
    <WorkspacePage
      title="Pub/Sub"
      description="Subscribe to channels (SUBSCRIBE) or glob patterns (PSUBSCRIBE) and watch live messages."
      actions={
        running ? (
          <Button variant="outline" size="sm" onClick={stop}>
            <Square className="size-4" /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={start}>
            <Play className="size-4" /> Subscribe
          </Button>
        )
      }
    >
      <div className="h-full min-h-0 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Channels (comma separated)
            </label>
            <Input
              value={channels}
              onChange={(e) => setChannels(e.target.value)}
              placeholder="channel-a, channel-b"
              disabled={running}
              spellCheck={false}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Patterns (comma separated, glob)
            </label>
            <Input
              value={patterns}
              onChange={(e) => setPatterns(e.target.value)}
              placeholder="orders.*, events.user.*"
              disabled={running}
              spellCheck={false}
              className="font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
          <span>
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
          <span>
            <span className="text-foreground tabular-nums">{messages.length}</span> messages
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMessages([])}
            className="h-7 text-xs"
          >
            <Trash2 className="size-3" /> clear
          </Button>
        </div>

        {errorMsg ? (
          <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
            {errorMsg}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 rounded-md border border-border/60 overflow-hidden bg-zinc-950 text-zinc-200 font-mono text-[11.5px]">
          <div ref={scrollRef} className="h-full overflow-auto">
            {messages.length === 0 ? (
              <div className="px-4 py-12 text-center text-zinc-500">
                no messages yet
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className="px-4 py-1 grid grid-cols-[120px_1fr_2fr] gap-3 hover:bg-white/[0.03]"
                >
                  <span className="text-zinc-500 tabular-nums">
                    {new Date(m.time).toISOString().slice(11, 23)}
                  </span>
                  <span
                    className={cn(
                      "truncate",
                      m.pattern
                        ? "text-fuchsia-400"
                        : "text-rose-400",
                    )}
                    title={m.pattern ? `${m.pattern} → ${m.channel}` : m.channel}
                  >
                    {m.pattern ? `${m.pattern} ▸ ${m.channel}` : m.channel}
                  </span>
                  <span className="whitespace-pre-wrap break-words">
                    {m.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </WorkspacePage>
  );
}
