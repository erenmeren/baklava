"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/components/workspace/format";
import { ArrowDownUp, AlertTriangle, RefreshCcw, Search } from "lucide-react";

interface StreamSummary {
  name: string;
  subjects: string[];
  messages: number;
  bytes: number;
  consumerCount: number;
  retention: string;
  storage: string;
  replicas: number;
  maxAge: number;
  maxMsgs: number;
  maxBytes: number;
  firstSeq: number;
  lastSeq: number;
  created?: string;
}

interface ListResult {
  jetstreamEnabled: boolean;
  streams: StreamSummary[];
  error?: string;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "messages" | "bytes" | "consumers";
type SortDir = "asc" | "desc";

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function formatAgeNanos(ns: number): string {
  if (!ns) return "∞";
  // nanos → ms
  const ms = ns / 1_000_000;
  const sec = ms / 1000;
  const min = sec / 60;
  const hr = min / 60;
  const day = hr / 24;
  if (day >= 1) return `${day.toFixed(day >= 10 ? 0 : 1)}d`;
  if (hr >= 1) return `${hr.toFixed(hr >= 10 ? 0 : 1)}h`;
  if (min >= 1) return `${min.toFixed(min >= 10 ? 0 : 1)}m`;
  return `${sec.toFixed(0)}s`;
}

function severityTone(messages: number): "ok" | "warn" | "high" {
  if (messages < 10_000) return "ok";
  if (messages < 1_000_000) return "warn";
  return "high";
}

export function StreamsClient({ connectionId }: Props) {
  const [data, setData] = useState<ListResult | null>(null);
  const [search, setSearch] = useState("");
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
      const res = await fetch(`/api/nats/${connectionId}/streams`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok) setData(json as ListResult);
      else {
        setError(json.error || "Could not load streams");
        toast.error("Could not load", { description: json.error });
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const q = search.trim().toLowerCase();
    let out = data.streams;
    if (q)
      out = out.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.subjects.some((sub) => sub.toLowerCase().includes(q))
      );
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "bytes") return (a.bytes - b.bytes) * mult;
      if (sort.key === "consumers")
        return (a.consumerCount - b.consumerCount) * mult;
      return (a.messages - b.messages) * mult;
    });
    return out;
  }, [data, search, sort]);

  const maxMessages = useMemo(
    () => data?.streams.reduce((m, s) => Math.max(m, s.messages), 0) ?? 0,
    [data]
  );

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  const totalMessages = data
    ? data.streams.reduce((s, t) => s + t.messages, 0)
    : 0;
  const totalBytes = data ? data.streams.reduce((s, t) => s + t.bytes, 0) : 0;

  return (
    <WorkspacePage
      title="Streams"
      description={
        filtered && data
          ? filtered.length === data.streams.length
            ? `${data.streams.length} stream${data.streams.length === 1 ? "" : "s"} · ${formatCompact(totalMessages)} msg · ${formatBytes(totalBytes)}`
            : `${filtered.length} of ${data.streams.length}`
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
              placeholder="Search streams or subjects…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        {data?.error ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {data.error}
          </div>
        ) : null}

        {data === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !data.jetstreamEnabled ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-8 text-center">
            <AlertTriangle className="size-6 mx-auto text-amber-500 mb-2" />
            <p className="text-sm font-semibold mb-1">JetStream not enabled</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Streams require JetStream. Start the server with{" "}
              <span className="font-mono text-foreground">-js</span> or add{" "}
              <span className="font-mono text-foreground">jetstream {`{}`}</span>{" "}
              to your config to unlock this view.
            </p>
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {data.streams.length === 0
              ? "No streams yet. Create one with `nats stream add`."
              : "No streams match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Stream"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <th className="px-3 py-2 text-left">Subjects</th>
                  <SortableTh
                    label="Messages"
                    keyName="messages"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[24%]"
                  />
                  <SortableTh
                    label="Bytes"
                    keyName="bytes"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[90px]"
                  />
                  <SortableTh
                    label="Cons"
                    keyName="consumers"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[70px]"
                  />
                  <th className="px-3 py-2 text-left w-[90px]">Retention</th>
                  <th className="px-3 py-2 text-left w-[80px]">Storage</th>
                  <th className="px-3 py-2 text-left w-[70px]">RF</th>
                  <th className="px-3 py-2 text-left w-[60px]">Age</th>
                </tr>
              </thead>
              <tbody>
                {filtered!.map((s) => (
                  <StreamRow
                    key={s.name}
                    connectionId={connectionId}
                    stream={s}
                    maxMessages={maxMessages}
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

function StreamRow({
  connectionId,
  stream,
  maxMessages,
}: {
  connectionId: string;
  stream: StreamSummary;
  maxMessages: number;
}) {
  const messagePct =
    maxMessages > 0 ? Math.min(100, (stream.messages / maxMessages) * 100) : 0;
  const tone = severityTone(stream.messages);
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <Link
          href={`/nats/${connectionId}/streams/${encodeURIComponent(stream.name)}`}
          className="font-mono text-xs truncate inline-block max-w-full hover:text-foreground hover:underline underline-offset-2 decoration-dotted"
        >
          {stream.name}
        </Link>
      </td>
      <td className="px-3 py-2 align-middle">
        <SubjectsList subjects={stream.subjects} />
      </td>
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
            {formatCompact(stream.messages)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                stream.messages === 0
                  ? "bg-muted"
                  : tone === "ok"
                    ? "bg-sky-500/70"
                    : tone === "warn"
                      ? "bg-gradient-to-r from-amber-500/70 to-orange-500/70"
                      : "bg-gradient-to-r from-rose-500/80 to-red-600/80"
              )}
              style={{ width: `${messagePct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatBytes(stream.bytes)}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {stream.consumerCount}
      </td>
      <td className="px-3 py-2 align-middle">
        <RetentionPill value={stream.retention} />
      </td>
      <td className="px-3 py-2 align-middle">
        <StoragePill value={stream.storage} />
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {stream.replicas}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatAgeNanos(stream.maxAge)}
      </td>
    </tr>
  );
}

function SubjectsList({ subjects }: { subjects: string[] }) {
  if (subjects.length === 0) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const shown = subjects.slice(0, 2);
  const more = subjects.length - shown.length;
  return (
    <div className="flex items-center gap-1 flex-wrap" title={subjects.join("\n")}>
      {shown.map((s) => (
        <span
          key={s}
          className="font-mono text-[10px] rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 truncate max-w-[180px]"
        >
          {s}
        </span>
      ))}
      {more > 0 ? (
        <span className="text-[10px] font-mono text-muted-foreground">
          +{more}
        </span>
      ) : null}
    </div>
  );
}

function RetentionPill({ value }: { value: string }) {
  const v = value.toLowerCase();
  const cls =
    v === "limits"
      ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : v === "interest"
        ? "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
        : v === "workqueue"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-border/60 bg-muted/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider",
        cls
      )}
    >
      {v || "—"}
    </span>
  );
}

function StoragePill({ value }: { value: string }) {
  const v = value.toLowerCase();
  const cls =
    v === "file"
      ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
      : v === "memory"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-border/60 bg-muted/40 text-muted-foreground";
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[9px] font-mono uppercase tracking-wider border",
        cls
      )}
    >
      {v || "—"}
    </Badge>
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
