"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  RewindIcon,
  Trash2,
} from "lucide-react";

interface GroupDetail {
  groupId: string;
  state: string;
  members: { memberId: string; clientId: string; clientHost: string }[];
  offsets: {
    topic: string;
    partition: number;
    offset: string;
    high: string;
    lag: number;
  }[];
}

type TargetKind = "earliest" | "latest" | "timestamp" | "offset";

interface Props {
  connectionId: string;
  group: string;
}

export function GroupDetailClient({ connectionId, group }: Props) {
  const router = useRouter();
  const base = `/api/kafka/${connectionId}/consumer-groups/${encodeURIComponent(group)}`;

  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTopic, setResetTopic] = useState<string>("");
  const [resetKind, setResetKind] = useState<TargetKind>("earliest");
  const [resetTimestamp, setResetTimestamp] = useState<string>("");
  const [resetOffset, setResetOffset] = useState<string>("0");
  const [resetPartitions, setResetPartitions] = useState<number[] | "all">(
    "all"
  );

  const load = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setDetail(data as GroupDetail);
    else toast.error("Could not load", { description: data.error });
  }, [base]);

  useEffect(() => {
    load();
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
          <span className="inline-flex items-center gap-2">
            <Badge
              variant={detail.state === "Stable" ? "default" : "secondary"}
            >
              {detail.state}
            </Badge>
            <span className="text-xs">
              {detail.members.length} member(s) ·{" "}
              {totalLag.toLocaleString()} lag
            </span>
          </span>
        ) : undefined
      }
      actions={
        <>
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
        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Members
          </h2>
          {detail ? (
            detail.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member ID</TableHead>
                      <TableHead>Client ID</TableHead>
                      <TableHead>Host</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.members.map((m) => (
                      <TableRow key={m.memberId}>
                        <TableCell className="font-mono text-xs break-all">
                          {m.memberId}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.clientId}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.clientHost}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <Skeleton className="h-20 w-full" />
          )}
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Topic offsets &amp; lag
          </h2>
          {detail ? (
            detail.offsets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offsets.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Topic</TableHead>
                      <TableHead>Partition</TableHead>
                      <TableHead>Current offset</TableHead>
                      <TableHead>Log end</TableHead>
                      <TableHead>Lag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.offsets.map((o) => (
                      <TableRow key={`${o.topic}.${o.partition}`}>
                        <TableCell className="font-mono text-xs">
                          {o.topic}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {o.partition}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {o.offset}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {o.high}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {o.lag > 0 ? (
                            <Badge variant="destructive">
                              {o.lag.toLocaleString()}
                            </Badge>
                          ) : (
                            o.lag
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <Skeleton className="h-32 w-full" />
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
