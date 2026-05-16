"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  Eraser,
  Loader2,
  Plus,
  RadioTower,
  RefreshCcw,
  Save,
  Send,
  Trash2,
} from "lucide-react";

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

interface KafkaMessage {
  partition: number;
  offset: string;
  timestamp: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

interface Props {
  connectionId: string;
  topic: string;
}

export function TopicDetailClient({ connectionId, topic }: Props) {
  const router = useRouter();
  const base = `/api/kafka/${connectionId}/topics/${encodeURIComponent(topic)}`;

  const [tab, setTab] = useState("partitions");
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [busy, setBusy] = useState(false);

  // messages tab
  const [messages, setMessages] = useState<KafkaMessage[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [partitionFilter, setPartitionFilter] = useState<string>("all");
  const [fromBeginning, setFromBeginning] = useState(true);
  const [live, setLive] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  // produce tab
  const [prodKey, setProdKey] = useState("");
  const [prodValue, setProdValue] = useState("");
  const [producing, setProducing] = useState(false);

  // configs tab — pending local edits
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  // dialogs
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
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

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true);
    setMessages(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      params.set("from", fromBeginning ? "beginning" : "end");
      if (partitionFilter !== "all") params.set("partition", partitionFilter);
      const res = await fetch(`${base}/messages?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setMessages(data.messages as KafkaMessage[]);
      else toast.error("Could not load messages", { description: data.error });
    } finally {
      setLoadingMessages(false);
    }
  }, [base, partitionFilter, fromBeginning]);

  // Open / close live tail
  useEffect(() => {
    if (!live) {
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }
    setMessages([]);
    const params = new URLSearchParams();
    params.set("fromBeginning", fromBeginning ? "1" : "0");
    if (partitionFilter !== "all") params.set("partition", partitionFilter);
    const es = new EventSource(`${base}/stream?${params.toString()}`);
    sourceRef.current = es;
    es.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse((ev as MessageEvent).data) as KafkaMessage;
        setMessages((prev) => {
          const next = [msg, ...(prev ?? [])];
          if (next.length > 500) next.length = 500;
          return next;
        });
      } catch {
        // ignore
      }
    });
    es.addEventListener("error", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data ?? "{}") as {
          message?: string;
        };
        if (data.message) toast.error("Live tail error", { description: data.message });
      } catch {
        // network error has no payload
      }
    });
    return () => {
      es.close();
      if (sourceRef.current === es) sourceRef.current = null;
    };
  }, [live, base, partitionFilter, fromBeginning]);

  // Unmount cleanup for SSE
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (tab === "messages" && messages === null && !live) {
      loadMessages();
    }
  }, [tab, messages, live, loadMessages]);

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
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Message produced");
        setProdValue("");
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
        if (messages) setMessages(null);
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
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partition</TableHead>
                    <TableHead>Leader</TableHead>
                    <TableHead>Replicas</TableHead>
                    <TableHead>ISR</TableHead>
                    <TableHead>Low</TableHead>
                    <TableHead>High</TableHead>
                    <TableHead>Messages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.partitions.map((p) => (
                    <TableRow key={p.partition}>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {p.partition}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.leader}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.replicas.join(", ")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.isr.join(", ")}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {p.low}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {p.high}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {(Number(p.high) - Number(p.low)).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>

        <TabsContent value="messages" className="pt-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="part-sel" className="text-xs">
                Partition
              </Label>
              <select
                id="part-sel"
                value={partitionFilter}
                onChange={(e) => setPartitionFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              >
                <option value="all">All</option>
                {detail?.partitions.map((p) => (
                  <option key={p.partition} value={String(p.partition)}>
                    {p.partition}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={fromBeginning}
                onChange={(e) => setFromBeginning(e.target.checked)}
              />
              From beginning
            </label>
            <Button
              size="sm"
              variant={live ? "default" : "outline"}
              onClick={() => setLive((l) => !l)}
            >
              <RadioTower className="size-3.5" />
              {live ? "Stop live tail" : "Live tail"}
              {live ? (
                <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider">
                  <span className="size-1.5 rounded-full bg-emerald-500 status-pulse" />
                  LIVE
                </span>
              ) : null}
            </Button>
            {!live ? (
              <Button
                size="sm"
                variant="outline"
                onClick={loadMessages}
                disabled={loadingMessages}
              >
                {loadingMessages ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="size-3.5" />
                )}
                Fetch
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMessages([])}
              >
                <Eraser className="size-3.5" />
                Clear
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {live
                ? `live · newest first · ${messages?.length ?? 0} buffered`
                : "up to 100 messages, 5s timeout"}
            </span>
          </div>

          {loadingMessages ? (
            <p className="text-sm text-muted-foreground">Consuming…</p>
          ) : messages == null ? null : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {live ? "Listening…" : "No messages within timeout."}
            </p>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-auto max-h-[60vh]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">P</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Offset
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">Time</th>
                    <th className="px-3 py-2 text-left font-semibold">Key</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m, i) => (
                    <tr
                      key={`${m.partition}-${m.offset}-${i}`}
                      className="border-t border-border/30"
                    >
                      <td className="px-3 py-1.5 align-top tabular-nums">
                        {m.partition}
                      </td>
                      <td className="px-3 py-1.5 align-top tabular-nums">
                        {m.offset}
                      </td>
                      <td className="px-3 py-1.5 align-top text-muted-foreground tabular-nums">
                        {new Date(Number(m.timestamp)).toISOString()}
                      </td>
                      <td className="px-3 py-1.5 align-top max-w-[20ch] truncate">
                        {m.key ?? (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top max-w-[60ch] whitespace-pre-wrap break-words">
                        {m.value ?? (
                          <span className="text-muted-foreground/50">null</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
    </WorkspacePage>
  );
}
