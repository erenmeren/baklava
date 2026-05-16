"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowDownUp,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";

interface TopicStat {
  name: string;
  partitions: number;
  replicas: number;
  internal: boolean;
  messages: number;
  underReplicated: boolean;
  partitionCounts: number[];
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "messages" | "partitions";
type SortDir = "asc" | "desc";

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

export function TopicsClient({ connectionId }: Props) {
  const [topics, setTopics] = useState<TopicStat[] | null>(null);
  const [includeInternal, setIncludeInternal] = useState(false);
  const [search, setSearch] = useState("");
  const [emptyFilter, setEmptyFilter] = useState<"all" | "non-empty" | "empty">(
    "all"
  );
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "messages",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPartitions, setCreatePartitions] = useState("1");
  const [createRf, setCreateRf] = useState("1");
  const [creating, setCreating] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<TopicStat | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ stats: "1" });
      if (includeInternal) params.set("internal", "1");
      const res = await fetch(
        `/api/kafka/${connectionId}/topics?${params.toString()}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setTopics(data.topics as TopicStat[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, includeInternal]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!topics) return null;
    const q = search.trim().toLowerCase();
    let out = topics;
    if (q) out = out.filter((t) => t.name.toLowerCase().includes(q));
    if (emptyFilter === "empty") out = out.filter((t) => t.messages === 0);
    if (emptyFilter === "non-empty") out = out.filter((t) => t.messages > 0);
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "messages") return (a.messages - b.messages) * mult;
      return (a.partitions - b.partitions) * mult;
    });
    return out;
  }, [topics, search, emptyFilter, sort]);

  const maxMessages = useMemo(
    () => topics?.reduce((m, t) => Math.max(m, t.messages), 0) ?? 0,
    [topics]
  );

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  const create = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/kafka/${connectionId}/topics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          partitions: Number(createPartitions),
          replicationFactor: Number(createRf),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Topic created");
        setCreateOpen(false);
        setCreateName("");
        await load();
      } else toast.error(data.error || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (t: TopicStat) => {
    setBusy(t.name);
    try {
      const res = await fetch(
        `/api/kafka/${connectionId}/topics/${encodeURIComponent(t.name)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success("Topic deleted");
        await load();
      } else toast.error(data.error || "Could not delete");
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  };

  return (
    <WorkspacePage
      title="Topics"
      description={
        filtered && topics
          ? filtered.length === topics.length
            ? `${topics.length} topic${topics.length === 1 ? "" : "s"} · ${formatCompact(topics.reduce((s, t) => s + t.messages, 0))} messages`
            : `${filtered.length} of ${topics.length}`
          : undefined
      }
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            <RefreshCcw
              className={cn("size-3.5", loading && "animate-spin")}
            />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New topic
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* ── Filter strip ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search topics…"
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
          <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={includeInternal}
              onChange={(e) => setIncludeInternal(e.target.checked)}
              className="size-3.5"
            />
            Show internal
          </label>
        </div>

        {/* ── Topics table ───────────────────────────────────────────────── */}
        {topics === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {topics.length === 0
              ? "No topics. Create one to get started."
              : "No topics match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Topic"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <SortableTh
                    label="Messages"
                    keyName="messages"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[28%]"
                  />
                  <SortableTh
                    label="Parts"
                    keyName="partitions"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[100px]"
                  />
                  <th className="px-3 py-2 text-left w-[80px]">RF</th>
                  <th className="px-3 py-2 text-left w-[80px]">ISR</th>
                  <th className="px-3 py-2 text-right w-[60px]">{""}</th>
                </tr>
              </thead>
              <tbody>
                {filtered!.map((t) => (
                  <TopicRow
                    key={t.name}
                    topic={t}
                    connectionId={connectionId}
                    maxMessages={maxMessages}
                    busy={busy === t.name}
                    onDelete={() => setConfirmDelete(t)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create topic</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="topic-name">Name</Label>
              <Input
                id="topic-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="my-topic"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="topic-partitions">Partitions</Label>
                <Input
                  id="topic-partitions"
                  value={createPartitions}
                  onChange={(e) => setCreatePartitions(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="topic-rf">Replication factor</Label>
                <Input
                  id="topic-rf"
                  value={createRf}
                  onChange={(e) => setCreateRf(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={create}
              disabled={creating || !createName.trim()}
            >
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete topic?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete topic{" "}
              <span className="font-mono">{confirmDelete?.name}</span> and all
              its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TopicRow({
  topic,
  connectionId,
  maxMessages,
  busy,
  onDelete,
}: {
  topic: TopicStat;
  connectionId: string;
  maxMessages: number;
  busy: boolean;
  onDelete: () => void;
}) {
  const messagePct =
    maxMessages > 0 ? Math.min(100, (topic.messages / maxMessages) * 100) : 0;
  const maxPart = Math.max(1, ...topic.partitionCounts);
  const isEmpty = topic.messages === 0;
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30 group">
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href={`/kafka/${connectionId}/topics/${encodeURIComponent(topic.name)}`}
            className="font-mono text-xs hover:underline truncate"
          >
            {topic.name}
          </Link>
          {topic.internal ? (
            <Badge
              variant="secondary"
              className="text-[9px] font-mono uppercase tracking-wider"
            >
              internal
            </Badge>
          ) : null}
          {isEmpty ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-border/60"
            >
              empty
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums w-14 text-right text-muted-foreground">
            {formatCompact(topic.messages)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isEmpty
                  ? "bg-muted"
                  : "bg-gradient-to-r from-orange-500/70 to-red-500/70"
              )}
              style={{ width: `${messagePct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums">
            {topic.partitions}
          </span>
          <PartitionSpark counts={topic.partitionCounts} max={maxPart} />
        </div>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
        {topic.replicas}
      </td>
      <td className="px-3 py-2 align-middle">
        {topic.underReplicated ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300"
            title="One or more partitions have replicas missing from the ISR set"
          >
            <span className="size-1 rounded-full bg-amber-500" />
            URP
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground"
            title="All replicas in-sync"
          >
            <span className="size-1 rounded-full bg-emerald-500" />
            ok
          </span>
        )}
      </td>
      <td className="px-3 py-2 align-middle text-right">
        <Button
          size="icon"
          variant="ghost"
          className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          onClick={onDelete}
          disabled={busy || topic.internal}
          title={topic.internal ? "Cannot delete internal" : "Delete"}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      </td>
    </tr>
  );
}

function PartitionSpark({ counts, max }: { counts: number[]; max: number }) {
  if (counts.length === 0) return null;
  // Cap display to first 32 partitions so it stays compact
  const shown = counts.slice(0, 32);
  return (
    <div
      className="flex items-end gap-[1px] h-4"
      title={`Per-partition counts (first ${shown.length}/${counts.length})`}
    >
      {shown.map((c, i) => {
        const h = max > 0 ? Math.max(2, (c / max) * 16) : 2;
        return (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-sm",
              c === 0 ? "bg-border" : "bg-orange-500/60"
            )}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
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
