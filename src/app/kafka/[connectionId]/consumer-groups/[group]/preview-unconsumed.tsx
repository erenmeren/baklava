"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronRight, Eye, Loader2 } from "lucide-react";

interface Offset {
  topic: string;
  partition: number;
  offset: string;
  high: string;
  lag: number;
}

interface KafkaMessage {
  partition: number;
  offset: string;
  timestamp: string;
  key: string | null;
  value: string | null;
  valueDecoded?: {
    schemaId: number;
    schemaType: "AVRO" | "JSON" | "PROTOBUF";
    subject: string | null;
    version: number | null;
    json: string | null;
  };
  headers: Record<string, string>;
}

interface Props {
  connectionId: string;
  offsets: Offset[];
}

interface PerPartition {
  topic: string;
  partition: number;
  loading: boolean;
  messages: KafkaMessage[] | null;
  error: string | null;
}

/**
 * "What would this consumer see next?" — for each partition with lag > 0,
 * fetches the next few messages starting at the committed offset using
 * the same /messages/seek endpoint the offset-jump UI uses. Each request
 * is independent so a single partition failing doesn't poison the panel.
 */
export function PreviewUnconsumed({ connectionId, offsets }: Props) {
  const partitionsWithLag = useMemo(
    () => offsets.filter((o) => o.lag > 0).slice(0, 32),
    [offsets],
  );
  const [perPartition, setPerPartition] = useState<
    Record<string, PerPartition>
  >({});
  const [running, setRunning] = useState(false);

  const key = (topic: string, partition: number) => `${topic}::${partition}`;

  const fetchOne = useCallback(
    async (o: Offset) => {
      const k = key(o.topic, o.partition);
      setPerPartition((s) => ({
        ...s,
        [k]: {
          topic: o.topic,
          partition: o.partition,
          loading: true,
          messages: null,
          error: null,
        },
      }));
      try {
        const res = await fetch(
          `/api/kafka/${connectionId}/topics/${encodeURIComponent(o.topic)}/messages/seek`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              partition: o.partition,
              offset: o.offset,
              limit: 3,
            }),
          },
        );
        const data = await res.json();
        if (!res.ok || data.error) {
          setPerPartition((s) => ({
            ...s,
            [k]: {
              topic: o.topic,
              partition: o.partition,
              loading: false,
              messages: null,
              error: data.error || `HTTP ${res.status}`,
            },
          }));
          return;
        }
        setPerPartition((s) => ({
          ...s,
          [k]: {
            topic: o.topic,
            partition: o.partition,
            loading: false,
            messages: (data.messages ?? []) as KafkaMessage[],
            error: null,
          },
        }));
      } catch (e) {
        setPerPartition((s) => ({
          ...s,
          [k]: {
            topic: o.topic,
            partition: o.partition,
            loading: false,
            messages: null,
            error: e instanceof Error ? e.message : String(e),
          },
        }));
      }
    },
    [connectionId],
  );

  const runAll = useCallback(async () => {
    setRunning(true);
    try {
      // Fire in parallel but cap concurrency to avoid spawning 32 consumers.
      const queue = [...partitionsWithLag];
      const workers = new Array(Math.min(6, queue.length)).fill(0).map(
        async () => {
          while (queue.length > 0) {
            const next = queue.shift();
            if (next) await fetchOne(next);
          }
        },
      );
      await Promise.all(workers);
    } finally {
      setRunning(false);
    }
  }, [partitionsWithLag, fetchOne]);

  if (partitionsWithLag.length === 0) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        Every partition is fully consumed — nothing waiting to be seen.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          For each lagging partition (max 32), Baklava reads up to 3
          messages starting at the committed offset — what the consumer
          would see on its next poll.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={runAll}
          disabled={running}
          className="gap-1.5"
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Eye className="size-3.5" />
          )}
          Preview {partitionsWithLag.length} partition
          {partitionsWithLag.length === 1 ? "" : "s"}
        </Button>
      </div>

      <div className="space-y-1.5">
        {partitionsWithLag.map((o) => {
          const k = key(o.topic, o.partition);
          const state = perPartition[k];
          return (
            <details
              key={k}
              className="rounded-md border border-border/60 bg-card/40"
            >
              <summary className="cursor-pointer flex items-center gap-2 px-3 py-1.5 text-xs font-mono">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                <span className="font-medium">{o.topic}</span>
                <span className="text-muted-foreground">
                  p{o.partition}
                </span>
                <span className="text-muted-foreground">
                  offset {o.offset} → HWM {o.high}
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-mono",
                      o.lag > 1000
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                        : o.lag > 100
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-sky-500/15 text-sky-700 dark:text-sky-400",
                    )}
                  >
                    {o.lag} lag
                  </span>
                  {!state ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.preventDefault();
                        void fetchOne(o);
                      }}
                    >
                      preview
                    </Button>
                  ) : null}
                </span>
              </summary>
              <div className="px-3 pb-3 border-t border-border/40 mt-1">
                {state?.loading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="size-3 animate-spin" />
                    reading…
                  </div>
                ) : state?.error ? (
                  <div className="text-xs text-rose-500 py-2">{state.error}</div>
                ) : state?.messages ? (
                  state.messages.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">
                      No messages — partition may have been compacted.
                    </div>
                  ) : (
                    <div className="space-y-1 py-1">
                      {state.messages.map((m, i) => (
                        <div
                          key={`${m.partition}-${m.offset}-${i}`}
                          className="text-[11px] font-mono bg-background/60 border border-border/40 rounded p-2"
                        >
                          <div className="flex items-center gap-2 text-muted-foreground mb-0.5">
                            <span>@{m.offset}</span>
                            <span>
                              {new Date(Number(m.timestamp)).toISOString().slice(11, 23)}
                            </span>
                            {m.key ? (
                              <span className="truncate max-w-[40ch]">key: {m.key}</span>
                            ) : null}
                          </div>
                          <div className="break-words line-clamp-3">
                            {m.valueDecoded?.json ?? m.value ?? (
                              <span className="text-muted-foreground/40">null</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="text-xs text-muted-foreground py-2">
                    Click preview to read the next ~3 messages.
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
