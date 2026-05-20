"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import {
  HeatLegend,
  PartitionCell,
  PartitionHeatmapGrid,
  formatPartitionCount,
} from "@/components/workspace/partition-heatmap";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  DatabaseBackup,
  Eraser,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { MessagesTab, type ProduceTemplate } from "./messages-tab";
import { BackupRestoreSheet } from "@/components/backup-restore-sheet";

interface TopicDetail {
  name: string;
  partitions: {
    partition: number;
    leader: number;
    replicas: number[];
    isr: number[];
    high: string;
    low: string;
  }[];
  configs: { name: string; value: string; isDefault: boolean }[];
}

interface Props {
  connectionId: string;
  topic: string;
}

export function TopicDetailClient({ connectionId, topic }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const base = `/api/kafka/${connectionId}/topics/${encodeURIComponent(topic)}`;

  // Deep-link entry: a partition-heatmap box elsewhere (e.g. the consumer-group
  // view) links here with ?tab=messages&partition=N. Seed the tab + partition
  // filter from the URL on mount so the messages tab opens already filtered.
  const partitionParam = searchParams.get("partition");
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState(tabParam ?? "partitions");
  // Partition fed to the messages tab. Drives a React key on <MessagesTab> so a
  // new selection remounts it and re-fetches. undefined ⇒ "all".
  const [msgPartition, setMsgPartition] = useState<string | undefined>(
    partitionParam ?? undefined,
  );

  // React to URL changes after mount (cross-page navigation into this already
  // mounted page). Manual tab clicks don't touch the params, so they're safe.
  useEffect(() => {
    if (partitionParam != null) {
      setMsgPartition(partitionParam);
      setTab("messages");
    } else if (tabParam) {
      setTab(tabParam);
    }
  }, [partitionParam, tabParam]);

  // Same-page jump from the Partitions-tab heatmap: switch to messages filtered
  // by this partition, no URL round-trip (so re-clicking the same box works).
  const openPartitionInMessages = useCallback((partition: number) => {
    setMsgPartition(String(partition));
    setTab("messages");
  }, []);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [busy, setBusy] = useState(false);

  // Message volume per partition (high − low) for the heatmap. Surfaces data
  // skew — a hot partition (often a poor key choice) lights up red.
  const partitionVolume = useMemo(() => {
    if (!detail) return { max: 0, total: 0 };
    let max = 0;
    let total = 0;
    for (const p of detail.partitions) {
      const hi = Number(p.high);
      const lo = Number(p.low);
      const msgs = hi >= 0 && lo >= 0 ? Math.max(0, hi - lo) : 0;
      total += msgs;
      if (msgs > max) max = msgs;
    }
    return { max, total };
  }, [detail]);

  // produce tab (state lives here so MessagesTab → "Produce similar" can
  // prefill the form and switch tabs via onProduceSimilar)
  const [prodKey, setProdKey] = useState("");
  const [prodValue, setProdValue] = useState("");
  const [prodHeaders, setProdHeaders] = useState<Record<string, string>>({});
  const [producing, setProducing] = useState(false);

  const onProduceSimilar = useCallback((t: ProduceTemplate) => {
    setProdKey(t.key ?? "");
    setProdValue(t.value);
    setProdHeaders(t.headers);
    setTab("produce");
    toast.success("Prefilled produce form", {
      description: "Edit and send when ready",
    });
  }, []);

  // configs tab — pending local edits
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  // dialogs
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [addPartitionsOpen, setAddPartitionsOpen] = useState(false);
  const [newPartitionCount, setNewPartitionCount] = useState("");

  const loadDetail = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setDetail(data as TopicDetail);
    else toast.error("Could not load topic", { description: data.error });
  }, [base]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const produce = async () => {
    if (!prodValue) return;
    setProducing(true);
    try {
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: prodKey || undefined,
          value: prodValue,
          headers:
            Object.keys(prodHeaders).length > 0 ? prodHeaders : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Message produced");
        setProdValue("");
        setProdHeaders({});
      } else toast.error(data.error || "Could not produce");
    } finally {
      setProducing(false);
    }
  };

  const saveConfigs = async () => {
    const entries = Object.entries(configEdits).map(([name, value]) => ({
      name,
      value,
    }));
    if (entries.length === 0) return;
    setSavingConfig(true);
    try {
      const res = await fetch(`${base}/configs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Updated ${entries.length} config${entries.length > 1 ? "s" : ""}`);
        setConfigEdits({});
        await loadDetail();
      } else {
        toast.error(data.error || "Could not save");
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const deleteTopic = async () => {
    setBusy(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Topic deleted");
        router.push(`/kafka/${connectionId}/topics`);
      } else toast.error(data.error || "Could not delete");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const emptyTopicAction = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${base}/empty`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Topic emptied");
        await loadDetail();
      } else toast.error(data.error || "Could not empty");
    } finally {
      setBusy(false);
      setConfirmEmpty(false);
    }
  };

  const addPartitions = async () => {
    const total = Number(newPartitionCount);
    if (!Number.isInteger(total) || total < 1) {
      toast.error("Enter a positive integer");
      return;
    }
    if (detail && total <= detail.partitions.length) {
      toast.error(
        `Must be greater than current count (${detail.partitions.length})`
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${base}/partitions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ totalPartitions: total }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Now ${total} partitions`);
        setAddPartitionsOpen(false);
        setNewPartitionCount("");
        await loadDetail();
      } else toast.error(data.error || "Could not add partitions");
    } finally {
      setBusy(false);
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(prodValue);
      setProdValue(JSON.stringify(parsed, null, 2));
    } catch {
      toast.error("Value is not valid JSON");
    }
  };

  const pendingEditCount = Object.keys(configEdits).length;

  return (
    <WorkspacePage
      title={<span className="font-mono">{topic}</span>}
      description={
        detail
          ? `${detail.partitions.length} partitions · ${detail.configs.length} configs`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/kafka/${connectionId}/topics`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddPartitionsOpen(true)}
            disabled={busy || !detail}
          >
            <Plus className="size-3.5" />
            Add partitions
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBackupOpen(true)}
            disabled={busy}
          >
            <DatabaseBackup className="size-3.5" />
            Backup
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmEmpty(true)}
            disabled={busy}
          >
            <Eraser className="size-3.5" />
            Empty
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="partitions">Partitions</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="produce">Produce</TabsTrigger>
          <TabsTrigger value="configs">
            Configs
            {pendingEditCount > 0 ? (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {pendingEditCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="partitions" className="pt-4">
          {detail ? (
            detail.partitions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                This topic has no partitions.
              </div>
            ) : (
              <div className="rounded-lg border border-border/60 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
                    {detail.partitions.length} partition
                    {detail.partitions.length === 1 ? "" : "s"} ·{" "}
                    {formatPartitionCount(partitionVolume.total)} messages
                  </span>
                  <HeatLegend
                    low="0 msgs"
                    high={formatPartitionCount(partitionVolume.max)}
                    title="Box color encodes message volume (high − low); the number inside is that partition's message count"
                  />
                </div>
                <PartitionHeatmapGrid>
                  {detail.partitions.map((p) => {
                    const hi = Number(p.high);
                    const lo = Number(p.low);
                    const known = hi >= 0 && lo >= 0;
                    const msgs = known ? Math.max(0, hi - lo) : 0;
                    return (
                      <PartitionCell
                        key={p.partition}
                        data={{
                          partition: p.partition,
                          intensity:
                            partitionVolume.max > 0
                              ? msgs / partitionVolume.max
                              : 0,
                          idle: !known || msgs === 0,
                          countLabel:
                            msgs > 0 ? formatPartitionCount(msgs) : undefined,
                          onClick: () => openPartitionInMessages(p.partition),
                          tooltip: [
                            `partition ${p.partition}`,
                            known ? `${msgs.toLocaleString()} messages` : "size unknown",
                            `offsets ${p.low} – ${p.high}`,
                            `leader ${p.leader}`,
                            `replicas ${p.replicas.join(", ")}`,
                            `isr ${p.isr.join(", ")}`,
                            "click → browse this partition's messages",
                          ].join("\n"),
                        }}
                      />
                    );
                  })}
                </PartitionHeatmapGrid>
              </div>
            )
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="messages" className="pt-4">
          <MessagesTab
            key={msgPartition ?? "all"}
            base={base}
            topic={topic}
            partitions={
              detail?.partitions.map((p) => ({
                partition: p.partition,
                leader: p.leader,
                offset: p.low,
                high: p.high,
              })) ?? []
            }
            initialPartition={msgPartition}
            onProduceSimilar={onProduceSimilar}
          />
        </TabsContent>

        <TabsContent value="produce" className="pt-4 space-y-3 max-w-2xl">
          <div className="space-y-2">
            <Label htmlFor="prod-key">Key (optional)</Label>
            <Input
              id="prod-key"
              value={prodKey}
              onChange={(e) => setProdKey(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prod-value">Value</Label>
              <Button
                size="xs"
                variant="ghost"
                onClick={formatJson}
                disabled={!prodValue}
              >
                Format JSON
              </Button>
            </div>
            <Textarea
              id="prod-value"
              value={prodValue}
              onChange={(e) => setProdValue(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </div>
          <Button onClick={produce} disabled={producing || !prodValue}>
            {producing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Produce
          </Button>
        </TabsContent>

        <TabsContent value="configs" className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Edit non-default settings to override broker defaults. Empty value
              reverts to default behavior.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfigEdits({})}
                disabled={pendingEditCount === 0 || savingConfig}
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={saveConfigs}
                disabled={pendingEditCount === 0 || savingConfig}
              >
                {savingConfig ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save{pendingEditCount > 0 ? ` (${pendingEditCount})` : ""}
              </Button>
            </div>
          </div>
          {detail ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Name</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="w-[100px] text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.configs.map((c) => {
                    const edited = c.name in configEdits;
                    const current = edited ? configEdits[c.name] : c.value;
                    return (
                      <TableRow
                        key={c.name}
                        className={cn(edited && "bg-amber-500/5")}
                      >
                        <TableCell className="font-mono text-xs align-top">
                          {c.name}
                          {edited ? (
                            <span className="ml-2 size-1.5 inline-block rounded-full bg-amber-500" />
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            value={current}
                            onChange={(e) =>
                              setConfigEdits((prev) =>
                                e.target.value === c.value
                                  ? Object.fromEntries(
                                      Object.entries(prev).filter(
                                        ([k]) => k !== c.name
                                      )
                                    )
                                  : { ...prev, [c.name]: e.target.value }
                              )
                            }
                            className="h-7 font-mono text-xs"
                            spellCheck={false}
                          />
                        </TableCell>
                        <TableCell className="text-right align-top">
                          {c.isDefault ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px]"
                            >
                              default
                            </Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete topic?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-mono">{topic}</span> and all its messages.
              The broker must have <code>delete.topic.enable=true</code>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteTopic}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty topic?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes <span className="font-mono">{topic}</span> and
              recreates it with the same partition count and replication factor.
              All current messages are lost. The broker must have{" "}
              <code>delete.topic.enable=true</code>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={emptyTopicAction}>
              Empty topic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={addPartitionsOpen} onOpenChange={setAddPartitionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add partitions</DialogTitle>
            <DialogDescription>
              Set the new total partition count. Must be greater than the
              current count of {detail?.partitions.length ?? "—"}. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-parts">New total partitions</Label>
            <Input
              id="new-parts"
              type="number"
              min={1}
              value={newPartitionCount}
              onChange={(e) => setNewPartitionCount(e.target.value)}
              placeholder={String((detail?.partitions.length ?? 0) + 1)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAddPartitionsOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={addPartitions} disabled={busy}>
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BackupRestoreSheet
        open={backupOpen}
        onOpenChange={setBackupOpen}
        mode="kafka"
        subject={topic}
        endpoint={`/api/kafka/${connectionId}/topics/${encodeURIComponent(topic)}/backup`}
      />
    </WorkspacePage>
  );
}
