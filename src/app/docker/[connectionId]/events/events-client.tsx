"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { Pause, Play, Trash2 } from "lucide-react";

interface DockerEvent {
  Type: string;
  Action: string;
  Actor?: {
    ID?: string;
    Attributes?: Record<string, string>;
  };
  scope?: string;
  time?: number;
  timeNano?: number;
  status?: string;
  id?: string;
  from?: string;
}

interface DisplayEvent {
  id: string;
  ts: number;
  type: string;
  action: string;
  target: string;
  attrs: Record<string, string>;
}

interface Props {
  connectionId: string;
}

const TYPE_COLORS: Record<string, string> = {
  container: "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30",
  image:
    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
  network:
    "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30",
  volume:
    "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
};

function formatTarget(e: DockerEvent): string {
  const attrs = e.Actor?.Attributes ?? {};
  if (e.Type === "container") return attrs.name || (e.Actor?.ID ?? "").slice(0, 12);
  if (e.Type === "image") return e.Actor?.ID ?? "";
  if (e.Type === "network") return attrs.name || (e.Actor?.ID ?? "").slice(0, 12);
  if (e.Type === "volume") return e.Actor?.ID ?? "";
  return e.Actor?.ID?.slice(0, 12) ?? "";
}

export function EventsClient({ connectionId }: Props) {
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (paused) {
      sourceRef.current?.close();
      sourceRef.current = null;
      setConnected(false);
      return;
    }
    const es = new EventSource(`/api/docker/${connectionId}/events`);
    sourceRef.current = es;
    es.addEventListener("ready", () => setConnected(true));
    es.addEventListener("event", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as DockerEvent;
        seqRef.current += 1;
        const display: DisplayEvent = {
          id: `${seqRef.current}-${data.timeNano ?? data.time ?? Date.now()}`,
          ts: (data.time ?? Date.now() / 1000) * 1000,
          type: data.Type,
          action: data.Action,
          target: formatTarget(data),
          attrs: data.Actor?.Attributes ?? {},
        };
        setEvents((prev) => [display, ...prev].slice(0, 500));
      } catch {
        // ignore
      }
    });
    es.addEventListener("error", () => {
      setConnected(false);
    });
    return () => {
      es.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [connectionId, paused]);

  const lower = filter.trim().toLowerCase();
  const filtered = lower
    ? events.filter(
        (e) =>
          e.type.toLowerCase().includes(lower) ||
          e.action.toLowerCase().includes(lower) ||
          e.target.toLowerCase().includes(lower) ||
          Object.values(e.attrs).some((v) => v.toLowerCase().includes(lower))
      )
    : events;

  return (
    <WorkspacePage
      title="Events"
      description={
        <span className="inline-flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected
                ? "bg-emerald-500 status-pulse"
                : "bg-muted-foreground/40"
            )}
          />
          {connected ? "live" : paused ? "paused" : "connecting…"}{" "}
          <span className="text-xs">· {events.length} events buffered</span>
        </span>
      }
      actions={
        <>
          <Input
            placeholder="filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-44"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? (
              <Play className="size-3.5" />
            ) : (
              <Pause className="size-3.5" />
            )}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEvents([])}
            disabled={events.length === 0}
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </>
      }
    >
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
          {lower
            ? "No events match the filter."
            : connected
              ? "Waiting for events… Try starting / stopping a container in another terminal."
              : "Connecting to the Docker daemon event stream…"}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/40">
          {filtered.map((e) => (
            <div
              key={e.id}
              className="px-4 py-2.5 grid grid-cols-[100px_120px_140px_1fr] gap-3 items-baseline text-xs"
            >
              <span className="font-mono text-muted-foreground tabular-nums">
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              <Badge
                variant="outline"
                className={cn("font-mono justify-center", TYPE_COLORS[e.type])}
              >
                {e.type}
              </Badge>
              <span className="font-mono">{e.action}</span>
              <span className="font-mono truncate text-foreground/80">
                {e.target}
                {Object.keys(e.attrs).length > 0 ? (
                  <span className="text-muted-foreground/70">
                    {" "}
                    {Object.entries(e.attrs)
                      .filter(([k]) => k !== "name")
                      .slice(0, 3)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </WorkspacePage>
  );
}
