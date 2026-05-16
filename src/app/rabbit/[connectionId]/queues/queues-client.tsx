"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

interface QueueStat {
  name: string;
  vhost: string;
  messages: number;
  messagesReady: number;
  messagesUnacknowledged: number;
  consumers: number;
  state: string;
  durable: boolean;
  autoDelete: boolean;
  exclusive: boolean;
  node?: string;
  type?: string;
  memory?: number;
  messageBytes?: number;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "messages" | "consumers";
type SortDir = "asc" | "desc";

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function severityTone(messages: number): "ok" | "warn" | "high" {
  if (messages < 1_000) return "ok";
  if (messages < 100_000) return "warn";
  return "high";
}

export function QueuesClient({ connectionId }: Props) {
  const [queues, setQueues] = useState<QueueStat[] | null>(null);
  const [search, setSearch] = useState("");
  const [emptyFilter, setEmptyFilter] = useState<"all" | "non-empty" | "empty">(
    "all"
  );
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "messages",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rabbit/${connectionId}/queues`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setQueues(data.queues as QueueStat[]);
      else {
        setError(data.error || "Could not load queues");
        toast.error("Could not load", { description: data.error });
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!queues) return null;
    const q = search.trim().toLowerCase();
    let out = queues;
    if (q) out = out.filter((t) => t.name.toLowerCase().includes(q));
    if (emptyFilter === "empty") out = out.filter((t) => t.messages === 0);
    if (emptyFilter === "non-empty") out = out.filter((t) => t.messages > 0);
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "consumers")
        return (a.consumers - b.consumers) * mult;
      return (a.messages - b.messages) * mult;
    });
    return out;
  }, [queues, search, emptyFilter, sort]);

  const maxMessages = useMemo(
    () => queues?.reduce((m, t) => Math.max(m, t.messages), 0) ?? 0,
    [queues]
  );

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  const totalMessages = queues
    ? queues.reduce((s, t) => s + t.messages, 0)
    : 0;
  const showSingleVhost =
    queues && queues.length > 0
      ? queues.every((q) => q.vhost === queues[0].vhost)
      : true;

  return (
    <WorkspacePage
      title="Queues"
      description={
        filtered && queues
          ? filtered.length === queues.length
            ? `${queues.length} queue${queues.length === 1 ? "" : "s"} · ${formatCompact(totalMessages)} messages`
            : `${filtered.length} of ${queues.length}`
          : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search queues…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
          <Segmented
            value={emptyFilter}
            onChange={setEmptyFilter}
            options={[
              { value: "all", label: "All" },
              { value: "non-empty", label: "Non-empty" },
              { value: "empty", label: "Empty" },
            ]}
          />
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {queues === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {queues.length === 0
              ? "No queues in this vhost yet."
              : "No queues match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Queue"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  {!showSingleVhost ? (
                    <th className="px-3 py-2 text-left w-[120px]">Vhost</th>
                  ) : null}
                  <SortableTh
                    label="Messages"
                    keyName="messages"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[26%]"
                  />
                  <th className="px-3 py-2 text-left w-[140px]">
                    Ready / Unacked
                  </th>
                  <SortableTh
                    label="Cons"
                    keyName="consumers"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[70px]"
                  />
                  <th className="px-3 py-2 text-left w-[90px]">State</th>
                  <th className="px-3 py-2 text-left w-[80px]">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered!.map((q) => (
                  <QueueRow
                    key={`${q.vhost}/${q.name}`}
                    queue={q}
                    maxMessages={maxMessages}
                    showVhost={!showSingleVhost}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function QueueRow({
  queue,
  maxMessages,
  showVhost,
}: {
  queue: QueueStat;
  maxMessages: number;
  showVhost: boolean;
}) {
  const messagePct =
    maxMessages > 0 ? Math.min(100, (queue.messages / maxMessages) * 100) : 0;
  const tone = severityTone(queue.messages);
  const totalForSplit = Math.max(
    1,
    queue.messagesReady + queue.messagesUnacknowledged
  );
  const readyPct = (queue.messagesReady / totalForSplit) * 100;
  const state = queue.state.toLowerCase();
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <span className="font-mono text-xs truncate inline-block max-w-full">
          {queue.name}
        </span>
      </td>
      {showVhost ? (
        <td className="px-3 py-2 align-middle font-mono text-[11px] text-muted-foreground">
          {queue.vhost}
        </td>
      ) : null}
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-mono text-xs tabular-nums w-14 text-right",
              tone === "ok" && "text-muted-foreground",
              tone === "warn" && "text-amber-600 dark:text-amber-400",
              tone === "high" && "text-rose-600 dark:text-rose-400"
            )}
          >
            {formatCompact(queue.messages)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                queue.messages === 0
                  ? "bg-muted"
                  : tone === "ok"
                    ? "bg-emerald-500/70"
                    : tone === "warn"
                      ? "bg-gradient-to-r from-amber-500/70 to-orange-500/70"
                      : "bg-gradient-to-r from-rose-500/80 to-red-600/80"
              )}
              style={{ width: `${messagePct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        {queue.messages === 0 ? (
          <span className="text-[11px] text-muted-foreground">—</span>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">
                {formatCompact(queue.messagesReady)}
              </span>
              <span className="text-amber-600 dark:text-amber-400">
                {formatCompact(queue.messagesUnacknowledged)}
              </span>
            </div>
            <div className="h-1 rounded-full bg-amber-500/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500/70 transition-all"
                style={{ width: `${readyPct}%` }}
              />
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {queue.consumers}
      </td>
      <td className="px-3 py-2 align-middle">
        <StatePill state={state} />
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-1">
          {queue.durable ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider border-border/60"
              title="Survives broker restart"
            >
              D
            </Badge>
          ) : null}
          {queue.autoDelete ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider border-border/60"
              title="Auto-delete when unused"
            >
              AD
            </Badge>
          ) : null}
          {queue.exclusive ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider border-border/60"
              title="Exclusive to declaring connection"
            >
              X
            </Badge>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function StatePill({ state }: { state: string }) {
  const cls =
    state === "running"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : state === "idle"
        ? "border-border/60 bg-muted/40 text-muted-foreground"
        : state === "flow"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-border/60 bg-muted/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider",
        cls
      )}
    >
      <span
        className={cn(
          "size-1 rounded-full",
          state === "running"
            ? "bg-emerald-500"
            : state === "flow"
              ? "bg-amber-500"
              : "bg-muted-foreground"
        )}
      />
      {state || "unknown"}
    </span>
  );
}

function SortableTh({
  label,
  keyName,
  sort,
  onClick,
  className,
}: {
  label: string;
  keyName: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onClick: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === keyName;
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onClick(keyName)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          active && "text-foreground"
        )}
      >
        {label}
        <ArrowDownUp
          className={cn(
            "size-3 opacity-0 transition-opacity",
            active && "opacity-60"
          )}
        />
      </button>
    </th>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 rounded-[5px] transition-colors",
            value === o.value
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
