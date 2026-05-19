"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/workspace/sparkline";
import { PreviewUnconsumed } from "./preview-unconsumed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { AutoRefresh } from "@/components/workspace/auto-refresh";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CopyIcon,
  Download,
  Loader2,
  MoreHorizontal,
  RewindIcon,
  SkipForward,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

interface Member {
  memberId: string;
  clientId: string;
  clientHost: string;
  assignments: { topic: string; partitions: number[] }[];
  partitionCount: number;
}

interface Offset {
  topic: string;
  partition: number;
  offset: string;
  high: string;
  lag: number;
  ownerMemberId?: string;
  ownerClientId?: string;
}

interface GroupDetail {
  groupId: string;
  state: string;
  protocolType?: string;
  protocol?: string;
  members: Member[];
  offsets: Offset[];
}

type TargetKind = "earliest" | "latest" | "timestamp" | "offset";

interface Props {
  connectionId: string;
  group: string;
}

const REFRESH_MS = 3_000;
const RATE_RING_SIZE = 60; // 60 × 3s ≈ 3 min of per-partition rate history
const fmt = new Intl.NumberFormat("en-US");

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

const STATE_TONE: Record<string, string> = {
  Stable:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  Empty: "bg-muted text-muted-foreground border-border/60",
  PreparingRebalance:
    "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  CompletingRebalance:
    "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  Dead: "bg-destructive/10 text-destructive border-destructive/30",
};

export function GroupDetailClient({ connectionId, group }: Props) {
  const router = useRouter();
  const base = `/api/kafka/${connectionId}/consumer-groups/${encodeURIComponent(group)}`;

  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTopic, setResetTopic] = useState<string>("");
  const [resetKind, setResetKind] = useState<TargetKind>("earliest");
  const [resetTimestamp, setResetTimestamp] = useState<string>("");
  const [resetOffset, setResetOffset] = useState<string>("0");
  const [resetPartitions, setResetPartitions] = useState<number[] | "all">(
    "all",
  );

  // Phase C action dialogs
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneTarget, setCloneTarget] = useState("");
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipTopic, setSkipTopic] = useState("");
  const [skipPartition, setSkipPartition] = useState("0");
  const [skipCount, setSkipCount] = useState("1");
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");

  // Per-poll snapshots — used to compute consumption rate by diffing the
  // current offset against the previous snapshot for each (topic, partition).
  const prevSnapshotRef = useRef<{
    timestamp: number;
    offsets: Map<string, number>; // key: topic/partition
    state: string;
  } | null>(null);
  const [consumptionRate, setConsumptionRate] = useState<number>(0); // msg/s
  // Per-partition consume-rate ring buffer keyed by "topic/partition".
  // Each entry is the last RATE_RING_SIZE samples (msgs/sec) — surfaces
  // the "one stuck partition" case that the lag heatmap obscures.
  const [partitionRates, setPartitionRates] = useState<Map<string, number[]>>(
    new Map(),
  );

  // Rebalance event timeline (Phase E). Each entry is a state transition;
  // we render the recent history as a tiny strip of colored ticks.
  type RebalanceEvent = {
    at: number;
    from: string;
    to: string;
  };
  const [rebalanceEvents, setRebalanceEvents] = useState<RebalanceEvent[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not load", { description: data.error });
        return;
      }
      const next = data as GroupDetail;
      // Compute msg/s from the offset delta since the prior snapshot.
      const now = Date.now();
      const offsetsMap = new Map<string, number>();
      let consumedSincePrev = 0;
      for (const o of next.offsets) {
        const key = `${o.topic}/${o.partition}`;
        const off = Number(o.offset);
        if (Number.isFinite(off)) offsetsMap.set(key, off);
      }
      const prev = prevSnapshotRef.current;
      if (prev) {
        const dtSec = Math.max(0.001, (now - prev.timestamp) / 1000);
        const perPartitionRate = new Map<string, number>();
        for (const [key, off] of offsetsMap) {
          const prevOff = prev.offsets.get(key);
          let delta = 0;
          if (prevOff != null && off > prevOff) {
            delta = off - prevOff;
            consumedSincePrev += delta;
          }
          perPartitionRate.set(key, delta / dtSec);
        }
        setConsumptionRate(consumedSincePrev / dtSec);
        setPartitionRates((existing) => {
          const next = new Map(existing);
          for (const [key, rate] of perPartitionRate) {
            const series = [...(next.get(key) ?? []), rate];
            if (series.length > RATE_RING_SIZE)
              series.splice(0, series.length - RATE_RING_SIZE);
            next.set(key, series);
          }
          // Drop series for partitions that vanished from the group.
          for (const k of [...next.keys()]) {
            if (!perPartitionRate.has(k)) next.delete(k);
          }
          return next;
        });
        // Detect a state transition and record it.
        if (prev.state !== next.state) {
          setRebalanceEvents((prev) => {
            const event: RebalanceEvent = {
              at: now,
              from: prevSnapshotRef.current!.state,
              to: next.state,
            };
            const merged = [...prev, event].slice(-40); // keep last 40
            return merged;
          });
        }
      }
      prevSnapshotRef.current = { timestamp: now, offsets: offsetsMap, state: next.state };
      setDetail(next);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalLag = detail?.offsets.reduce((sum, o) => sum + o.lag, 0) ?? 0;
  const topics = useMemo(() => {
    if (!detail) return [];
    return Array.from(new Set(detail.offsets.map((o) => o.topic))).sort();
  }, [detail]);

  useEffect(() => {
    if (topics.length > 0 && !resetTopic) {
      setResetTopic(topics[0]);
    }
  }, [topics, resetTopic]);

  const partitionsForTopic = useMemo(() => {
    if (!detail || !resetTopic) return [] as number[];
    return detail.offsets
      .filter((o) => o.topic === resetTopic)
      .map((o) => o.partition)
      .sort((a, b) => a - b);
  }, [detail, resetTopic]);

  // ETA: seconds to drain at current consumption rate.
  const etaSec =
    consumptionRate > 0 && totalLag > 0 ? totalLag / consumptionRate : NaN;

  const submitReset = async () => {
    if (!resetTopic) return;
    let target;
    if (resetKind === "earliest" || resetKind === "latest") {
      target = { kind: resetKind };
    } else if (resetKind === "timestamp") {
      const t = resetTimestamp ? new Date(resetTimestamp).getTime() : NaN;
      if (!Number.isFinite(t)) {
        toast.error("Pick a valid date/time");
        return;
      }
      target = { kind: "timestamp", timestamp: t };
    } else {
      if (!resetOffset.trim()) {
        toast.error("Enter an offset");
        return;
      }
      target = { kind: "offset", offset: resetOffset.trim() };
    }
    const partitions =
      resetPartitions === "all" ? undefined : resetPartitions;
    setBusy(true);
    try {
      const res = await fetch(`${base}/offsets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: resetTopic,
          target,
          partitions,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Offsets reset");
        setResetOpen(false);
        await load();
      } else {
        toast.error(data.error || "Could not reset", {
          description: data.hint,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const submitClone = async () => {
    const target = cloneTarget.trim();
    if (!target) {
      toast.error("Enter a target group id");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${base}/clone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetGroupId: target }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Cloned ${data.copied} offsets to ${target}`);
        setCloneOpen(false);
        setCloneTarget("");
      } else {
        toast.error(data.error || "Could not clone");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitSkip = async () => {
    if (!skipTopic) {
      toast.error("Pick a topic");
      return;
    }
    const partition = Number(skipPartition);
    const count = Number(skipCount);
    if (!Number.isFinite(partition) || partition < 0) {
      toast.error("Partition must be a non-negative integer");
      return;
    }
    if (!Number.isFinite(count) || count < 1) {
      toast.error("Skip count must be at least 1");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${base}/skip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: skipTopic, partition, count }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Skipped ${count} message${count === 1 ? "" : "s"}`, {
          description: `${skipTopic}[${partition}] · ${data.from} → ${data.to}`,
        });
        setSkipOpen(false);
        await load();
      } else {
        toast.error(data.error || "Could not skip", {
          description: data.hint,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const submitImport = async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(importJson);
    } catch {
      toast.error("Not valid JSON");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${base}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Imported ${data.committed} offsets`);
        setImportOpen(false);
        setImportJson("");
        await load();
      } else {
        toast.error(data.error || "Could not import", {
          description: data.hint,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteGroup = async () => {
    setBusy(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Consumer group deleted");
        router.push(`/kafka/${connectionId}/consumer-groups`);
      } else {
        toast.error(data.error || "Could not delete");
      }
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <WorkspacePage
      title={<span className="font-mono">{group}</span>}
      description={
        detail ? (
          <span className="inline-flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-mono uppercase tracking-wider",
                STATE_TONE[detail.state] ||
                  "bg-secondary text-secondary-foreground border-border/60",
              )}
            >
              {detail.state}
            </Badge>
            {detail.protocol ? (
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {detail.protocol}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {detail.members.length} member{detail.members.length === 1 ? "" : "s"} ·{" "}
              {fmt.format(totalLag)} lag
            </span>
          </span>
        ) : undefined
      }
      actions={
        <>
          <AutoRefresh
            intervalMs={REFRESH_MS}
            onTick={load}
            loading={loading}
          />
          <Link
            href={`/kafka/${connectionId}/consumer-groups`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setResetOpen(true)}
            disabled={busy || !detail || topics.length === 0}
          >
            <RewindIcon className="size-3.5" />
            Reset offsets
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !detail}
                  aria-label="More actions"
                >
                  <MoreHorizontal className="size-3.5" />
                  More
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Group operations</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    setCloneTarget(`${group}-copy`);
                    setCloneOpen(true);
                  }}
                >
                  <CopyIcon className="size-3.5" />
                  Clone to new group…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (topics.length > 0) setSkipTopic(topics[0]);
                    setSkipOpen(true);
                  }}
                  disabled={topics.length === 0}
                >
                  <SkipForward className="size-3.5" />
                  Skip past a message…
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Backup &amp; restore</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    // Trigger a programmatic download — keeps the menu
                    // item behaviorally consistent with the other actions.
                    const a = document.createElement("a");
                    a.href = `${base}/export?download=1`;
                    a.rel = "noopener";
                    a.click();
                  }}
                >
                  <Download className="size-3.5" />
                  Export offsets (JSON)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImportOpen(true)}>
                  <Upload className="size-3.5" />
                  Import offsets…
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
            Delete group
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Rebalance timeline */}
        {rebalanceEvents.length > 0 ? (
          <RebalanceTimeline events={rebalanceEvents} />
        ) : null}

        {/* Top stats */}
        <DetailStats
          totalLag={totalLag}
          consumptionRate={consumptionRate}
          etaSec={etaSec}
          memberCount={detail?.members.length ?? 0}
          partitionCount={detail?.offsets.length ?? 0}
        />

        {/* Member assignment graph */}
        <section>
          <SectionHeader
            label="Members & assignments"
            sub={
              detail
                ? detail.members.length === 0
                  ? "no active consumers — group is idle"
                  : `${detail.members.length} consumer${detail.members.length === 1 ? "" : "s"}`
                : undefined
            }
          />
          {detail ? (
            detail.members.length === 0 ? (
              <EmptyMembersHint />
            ) : (
              <MemberAssignmentGrid members={detail.members} />
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </section>

        {/* Partition heatmap */}
        <section>
          <SectionHeader
            label="Partition lag heatmap"
            sub={
              detail
                ? `${topics.length} topic${topics.length === 1 ? "" : "s"} · ${detail.offsets.length} partition${detail.offsets.length === 1 ? "" : "s"}`
                : undefined
            }
          />
          {detail ? (
            detail.offsets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offsets.</p>
            ) : (
              <PartitionHeatmap
                connectionId={connectionId}
                offsets={detail.offsets}
                members={detail.members}
              />
            )
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </section>

        {/* Per-partition consume rate — surfaces "one stuck partition" */}
        <section>
          <SectionHeader
            label="Consume rate per partition"
            sub="msgs/sec over the last ~3 min, live. Flat lines while peers are busy = stuck partition."
          />
          {detail && detail.offsets.length > 0 ? (
            <PartitionRatePanel
              offsets={detail.offsets}
              history={partitionRates}
            />
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </section>

        {/* What would this consumer see right now? */}
        <section>
          <SectionHeader
            label="Preview unconsumed"
            sub="Reads the next few messages each lagging partition would deliver."
          />
          {detail ? (
            <PreviewUnconsumed
              connectionId={connectionId}
              offsets={detail.offsets}
            />
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </section>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset offsets</DialogTitle>
            <DialogDescription>
              The group must be empty (no active members) for the broker to
              accept this. Stop your consumers first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-topic">Topic</Label>
              <select
                id="reset-topic"
                value={resetTopic}
                onChange={(e) => {
                  setResetTopic(e.target.value);
                  setResetPartitions("all");
                }}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm font-mono"
              >
                {topics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Target</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["earliest", "Earliest"],
                    ["latest", "Latest"],
                    ["timestamp", "Timestamp"],
                    ["offset", "Specific offset"],
                  ] as [TargetKind, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setResetKind(k)}
                    className={
                      "rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-wider " +
                      (resetKind === k
                        ? "border-foreground bg-foreground/5"
                        : "border-border hover:bg-muted")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {resetKind === "timestamp" ? (
              <div className="space-y-2">
                <Label htmlFor="reset-ts">Date / time</Label>
                <Input
                  id="reset-ts"
                  type="datetime-local"
                  value={resetTimestamp}
                  onChange={(e) => setResetTimestamp(e.target.value)}
                />
              </div>
            ) : null}

            {resetKind === "offset" ? (
              <div className="space-y-2">
                <Label htmlFor="reset-off">Offset</Label>
                <Input
                  id="reset-off"
                  value={resetOffset}
                  onChange={(e) => setResetOffset(e.target.value)}
                  placeholder="0"
                />
                <p className="text-[10px] text-muted-foreground">
                  Applied to all selected partitions.
                </p>
              </div>
            ) : null}

            {(resetKind === "timestamp" || resetKind === "offset") &&
            partitionsForTopic.length > 1 ? (
              <div className="space-y-2">
                <Label>Partitions</Label>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setResetPartitions("all")}
                    className={
                      "rounded-md border px-2 py-0.5 text-xs font-mono " +
                      (resetPartitions === "all"
                        ? "border-foreground bg-foreground/5"
                        : "border-border hover:bg-muted")
                    }
                  >
                    All
                  </button>
                  {partitionsForTopic.map((p) => {
                    const selected =
                      resetPartitions !== "all" &&
                      resetPartitions.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setResetPartitions((prev) => {
                            const arr = prev === "all" ? [] : [...prev];
                            const idx = arr.indexOf(p);
                            if (idx >= 0) arr.splice(idx, 1);
                            else arr.push(p);
                            return arr.length === 0 ? "all" : arr;
                          });
                        }}
                        className={
                          "rounded-md border px-2 py-0.5 text-xs font-mono " +
                          (selected
                            ? "border-foreground bg-foreground/5"
                            : "border-border hover:bg-muted")
                        }
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setResetOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={submitReset} disabled={busy || !resetTopic}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone group */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clone consumer group</DialogTitle>
            <DialogDescription>
              Copies all committed offsets from{" "}
              <span className="font-mono">{group}</span> to a new group id.
              Useful for canary deployments and replay testing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="clone-target">Target group id</Label>
            <Input
              id="clone-target"
              value={cloneTarget}
              onChange={(e) => setCloneTarget(e.target.value)}
              className="font-mono"
              spellCheck={false}
              placeholder={`${group}-copy`}
            />
            <p className="text-[10px] text-muted-foreground">
              The new group will be created on first commit. No data is moved —
              only offsets.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCloneOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={submitClone} disabled={busy || !cloneTarget.trim()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Skip poison message */}
      <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Skip past a message</DialogTitle>
            <DialogDescription>
              Advances the committed offset of one partition by N. Group must
              be Empty (no active members).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="skip-topic">Topic</Label>
              <select
                id="skip-topic"
                value={skipTopic}
                onChange={(e) => setSkipTopic(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm font-mono"
              >
                {topics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="skip-partition">Partition</Label>
                <Input
                  id="skip-partition"
                  value={skipPartition}
                  onChange={(e) => setSkipPartition(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="skip-count">Skip count</Label>
                <Input
                  id="skip-count"
                  value={skipCount}
                  onChange={(e) => setSkipCount(e.target.value)}
                  inputMode="numeric"
                  className="font-mono"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSkipOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={submitSkip} disabled={busy || !skipTopic}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Skip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import offsets */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import offsets</DialogTitle>
            <DialogDescription>
              Paste a JSON snapshot exported from this or another group. Group
              must be Empty.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="import-json">Snapshot JSON</Label>
            <Textarea
              id="import-json"
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='{"offsets":[{"topic":"orders","partition":0,"offset":"12345"}]}'
              className="font-mono text-xs h-44"
              spellCheck={false}
            />
            <p className="text-[10px] text-muted-foreground">
              Accepts either a flat array or the full export envelope.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setImportOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={submitImport}
              disabled={busy || !importJson.trim()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete consumer group?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently removes <span className="font-mono">{group}</span>.
              The group must be empty (no active members). Committed offsets
              will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteGroup}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  sub,
}: {
  label: string;
  sub?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </h2>
      {sub ? (
        <span className="text-[10px] font-mono text-muted-foreground/80 tabular-nums">
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function DetailStats({
  totalLag,
  consumptionRate,
  etaSec,
  memberCount,
  partitionCount,
}: {
  totalLag: number;
  consumptionRate: number;
  etaSec: number;
  memberCount: number;
  partitionCount: number;
}) {
  const items = [
    {
      label: "Total lag",
      value: formatCompact(totalLag),
      sub: totalLag === 0 ? "fully drained" : "messages behind",
      tone: totalLag === 0 ? ("ok" as const) : totalLag > 10_000 ? ("alert" as const) : ("neutral" as const),
    },
    {
      label: "Consumption",
      value: consumptionRate > 0 ? `${formatCompact(Math.round(consumptionRate))} /s` : "—",
      sub:
        consumptionRate > 0
          ? "observed since last poll"
          : "waiting for delta…",
      tone: "neutral" as const,
    },
    {
      label: "ETA to drain",
      value: formatDuration(etaSec),
      sub:
        consumptionRate <= 0
          ? "need throughput first"
          : totalLag === 0
            ? "already drained"
            : "at current rate",
      tone:
        consumptionRate > 0 && totalLag > 0
          ? etaSec > 3600
            ? ("alert" as const)
            : ("ok" as const)
          : "neutral" as const,
    },
    {
      label: "Partitions",
      value: fmt.format(partitionCount),
      sub: `${memberCount} member${memberCount === 1 ? "" : "s"}`,
      tone: "neutral" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className={cn(
            "relative overflow-hidden rounded-xl border bg-card/40 px-4 py-3",
            it.tone === "alert"
              ? "border-red-500/40 bg-red-500/[0.04]"
              : it.tone === "ok"
                ? "border-emerald-500/30 bg-emerald-500/[0.03]"
                : "border-border/60",
          )}
        >
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute -right-6 -top-6 size-16 rounded-full blur-2xl opacity-50",
              it.tone === "alert"
                ? "bg-red-500/30"
                : it.tone === "ok"
                  ? "bg-emerald-500/30"
                  : "bg-brand/15",
            )}
          />
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            {it.label}
          </div>
          <div
            className={cn(
              "mt-1.5 font-semibold tabular-nums text-2xl tracking-tight",
              it.tone === "alert" && "text-red-600 dark:text-red-400",
            )}
            style={{
              fontFamily:
                "var(--font-jetbrains-mono), ui-monospace, monospace",
            }}
          >
            {it.value}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums truncate">
            {it.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function MemberAssignmentGrid({ members }: { members: Member[] }) {
  // Sort by partition count desc so the busiest members surface first.
  const sorted = [...members].sort(
    (a, b) => b.partitionCount - a.partitionCount,
  );
  const maxPartitions = Math.max(1, ...sorted.map((m) => m.partitionCount));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {sorted.map((m) => {
        const skewed = m.partitionCount === 0;
        return (
          <div
            key={m.memberId}
            className={cn(
              "relative rounded-xl border bg-card/40 px-4 py-3",
              "border-border/60 hover:bg-card/60 transition-colors",
              skewed && "border-amber-500/40 bg-amber-500/[0.03]",
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div
                  className="font-mono text-sm font-semibold truncate"
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                  }}
                >
                  {m.clientId || "(anonymous)"}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">
                  {m.clientHost} · <span className="opacity-60">{m.memberId}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div
                  className={cn(
                    "font-mono text-lg tabular-nums",
                    skewed && "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {m.partitionCount}
                </div>
                <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                  partitions
                </div>
              </div>
            </div>
            {/* Bar = relative share of partitions */}
            <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  skewed ? "bg-amber-500" : "bg-brand",
                )}
                style={{
                  width: `${Math.max(2, (m.partitionCount / maxPartitions) * 100)}%`,
                }}
              />
            </div>
            {m.assignments.length > 0 ? (
              <div className="mt-3 space-y-1">
                {m.assignments.map((a) => (
                  <div key={a.topic} className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground truncate min-w-0 flex-1">
                      {a.topic}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      [{a.partitions.length}]
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <Users className="size-3" />
                idle — no partitions assigned
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyMembersHint() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">
        No active members. Stored offsets persist — start a consumer using this
        group id to pick up where it left off.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PartitionHeatmap({
  connectionId,
  offsets,
  members,
}: {
  connectionId: string;
  offsets: Offset[];
  members: Member[];
}) {
  // Group offsets by topic and find max lag (per topic for relative shading).
  const grouped = useMemo(() => {
    const map = new Map<string, Offset[]>();
    for (const o of offsets) {
      const arr = map.get(o.topic) ?? [];
      arr.push(o);
      map.set(o.topic, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.partition - b.partition);
    }
    return map;
  }, [offsets]);

  // memberId → clientId for hover details.
  const memberLookup = useMemo(
    () => new Map(members.map((m) => [m.memberId, m])),
    [members],
  );

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([topic, parts]) => {
        const topicTotalLag = parts.reduce((s, p) => s + p.lag, 0);
        const maxLag = Math.max(1, ...parts.map((p) => p.lag));
        return (
          <div
            key={topic}
            className="rounded-xl border border-border/60 bg-card/30 overflow-hidden"
          >
            <header className="flex items-baseline justify-between gap-2 px-3 py-2 border-b border-border/40 bg-muted/20">
              <div className="flex items-baseline gap-2 min-w-0">
                <span
                  className="font-mono text-sm font-semibold truncate"
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                  }}
                  title={topic}
                >
                  {topic}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {parts.length} part
                </span>
              </div>
              <div className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
                {formatCompact(topicTotalLag)} lag
              </div>
            </header>
            <div className="p-3">
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(46px, 1fr))",
                }}
              >
                {parts.map((p) => (
                  <PartitionCell
                    key={p.partition}
                    offset={p}
                    maxLag={maxLag}
                    connectionId={connectionId}
                    ownerClient={
                      p.ownerMemberId
                        ? memberLookup.get(p.ownerMemberId)?.clientId
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RebalanceTimeline({
  events,
}: {
  events: { at: number; from: string; to: string }[];
}) {
  // Re-anchor `now` on every events change + every second so the strip
  // doesn't drift visually. We do NOT call Date.now() in render directly
  // (react-hooks/purity flags impure calls in the render path).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [events]);

  if (events.length === 0) return null;
  const windowMs = Math.max(60_000, now - events[0].at);
  const lastEventAgo = Math.round((now - events[events.length - 1].at) / 1000);
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Rebalance timeline
        </div>
        <div className="text-[10px] font-mono text-muted-foreground tabular-nums">
          {events.length} event{events.length === 1 ? "" : "s"} · last {lastEventAgo}s ago
        </div>
      </div>
      <div className="relative h-6 rounded-md bg-muted/40 overflow-hidden">
        {events.map((e, i) => {
          const x = ((e.at - (now - windowMs)) / windowMs) * 100;
          const isStable = e.to === "Stable";
          const isPreparing = e.to.includes("Preparing");
          return (
            <div
              key={i}
              title={`${new Date(e.at).toLocaleTimeString()} — ${e.from} → ${e.to}`}
              className={cn(
                "absolute top-0 bottom-0 w-[2px]",
                isStable
                  ? "bg-emerald-500"
                  : isPreparing
                    ? "bg-amber-500"
                    : "bg-sky-500",
              )}
              style={{ left: `${Math.max(0, Math.min(99, x))}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-mono text-muted-foreground tabular-nums">
        <span>{Math.round(windowMs / 60_000)}m ago</span>
        <span>now</span>
      </div>
    </div>
  );
}

function PartitionCell({
  offset,
  maxLag,
  connectionId,
  ownerClient,
}: {
  offset: Offset;
  maxLag: number;
  connectionId: string;
  ownerClient?: string;
}) {
  const high = Number(offset.high);
  const off = Number(offset.offset);
  const idle = high <= 0; // no messages ever produced on this partition
  const intensity = offset.lag === 0 ? 0 : Math.min(1, offset.lag / maxLag);

  // Color: green when no lag, amber for some, red for a lot. Intensity
  // raises the cell's alpha so the eye is drawn to the worst partitions.
  const bg = idle
    ? "bg-muted/30 border-border/40"
    : offset.lag === 0
      ? "bg-emerald-500/15 border-emerald-500/30 hover:bg-emerald-500/25"
      : offset.lag < maxLag * 0.25
        ? "bg-amber-500/15 border-amber-500/30 hover:bg-amber-500/25"
        : offset.lag < maxLag * 0.6
          ? "bg-amber-500/30 border-amber-500/50 hover:bg-amber-500/40"
          : "bg-red-500/30 border-red-500/50 hover:bg-red-500/45";

  // Border emphasis when this is the heaviest partition.
  const heaviest = intensity >= 0.95 && offset.lag > 0;

  const tooltip = [
    `partition ${offset.partition}`,
    `offset ${offset.offset} / high ${offset.high}`,
    `lag ${fmt.format(offset.lag)}`,
    ownerClient ? `owned by ${ownerClient}` : "no owner",
    idle ? "no messages produced yet" : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Future Phase C: this Link will jump to the topic messages browser at
  // the current offset. Wiring the route here so it's ready.
  const href = `/kafka/${connectionId}/topics/${encodeURIComponent(offset.topic)}?partition=${offset.partition}&offset=${offset.offset}`;

  return (
    <Link
      href={href}
      title={tooltip}
      className={cn(
        "group/cell relative aspect-square rounded-md border",
        "flex flex-col items-center justify-center gap-0.5",
        "transition-all duration-150",
        bg,
        heaviest && "ring-1 ring-red-500/70 shadow-[0_0_10px_-2px_rgba(239,68,68,0.5)]",
      )}
    >
      <span
        className={cn(
          "font-mono text-[11px] font-semibold tabular-nums leading-none",
          idle && "text-muted-foreground",
        )}
      >
        {offset.partition}
      </span>
      {offset.lag > 0 ? (
        <span
          className={cn(
            "font-mono text-[9px] tabular-nums leading-none",
            heaviest
              ? "text-red-700 dark:text-red-300 font-semibold"
              : "text-muted-foreground",
          )}
        >
          {formatCompact(offset.lag)}
        </span>
      ) : (
        <span className="text-[9px] text-muted-foreground/40">·</span>
      )}
      {/* Tiny owner indicator at the bottom-right corner */}
      {ownerClient ? (
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 size-1 rounded-full bg-brand status-pulse"
        />
      ) : null}
      {/* Idle "no producer" badge */}
      {off < 0 && !idle ? (
        <span className="absolute top-0.5 right-0.5 text-[8px] text-muted-foreground/60">
          ?
        </span>
      ) : null}
    </Link>
  );
}

// ─── Per-partition consume rate panel ───────────────────────────────────

interface RateOffset {
  topic: string;
  partition: number;
  lag: number;
}

function PartitionRatePanel({
  offsets,
  history,
}: {
  offsets: RateOffset[];
  history: Map<string, number[]>;
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, RateOffset[]>();
    for (const o of offsets) {
      const arr = m.get(o.topic) ?? [];
      arr.push(o);
      m.set(o.topic, arr);
    }
    for (const [, parts] of m) parts.sort((a, b) => a.partition - b.partition);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [offsets]);

  // Cap rendered partitions per topic so a 256-partition stream-processor
  // topic doesn't blow out the page.
  const MAX_PER_TOPIC = 32;

  return (
    <div className="space-y-4">
      {grouped.map(([topic, parts]) => {
        const truncated = parts.length > MAX_PER_TOPIC;
        const shown = truncated ? parts.slice(0, MAX_PER_TOPIC) : parts;
        return (
          <div key={topic}>
            <div className="flex items-baseline justify-between mb-1.5">
              <h4 className="text-xs font-mono">{topic}</h4>
              <span className="text-[10px] font-mono text-muted-foreground">
                {parts.length} partition{parts.length === 1 ? "" : "s"}
                {truncated ? ` · showing first ${MAX_PER_TOPIC}` : ""}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
              {shown.map((o) => {
                const key = `${o.topic}/${o.partition}`;
                const series = history.get(key) ?? [];
                const latest = series[series.length - 1] ?? 0;
                const stuck = o.lag > 0 && latest < 0.01 && series.length > 5;
                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-md border bg-card/40 px-2 py-1.5",
                      stuck
                        ? "border-rose-500/40 bg-rose-500/5"
                        : "border-border/60",
                    )}
                    title={
                      stuck
                        ? `Lag ${o.lag} but no consumption in the last samples — partition may be stuck`
                        : undefined
                    }
                  >
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        p{o.partition}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[10px] tabular-nums",
                          stuck
                            ? "text-rose-600"
                            : latest > 0
                              ? "text-emerald-600"
                              : "text-muted-foreground/60",
                        )}
                      >
                        {latest >= 1
                          ? `${latest.toFixed(0)}/s`
                          : latest > 0
                            ? `${latest.toFixed(2)}/s`
                            : "·"}
                      </span>
                    </div>
                    <Sparkline
                      values={series}
                      tone="neutral"
                      width={120}
                      height={20}
                      className={cn(
                        stuck && "text-rose-500",
                        !stuck && latest > 0 && "text-emerald-500",
                        !stuck && latest === 0 && "text-muted-foreground/40",
                      )}
                      ariaLabel={`p${o.partition} consume rate`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
