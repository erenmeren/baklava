"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { formatBytes } from "@/components/workspace/format";
import { RelativeTime } from "@/components/workspace/relative-time";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Eraser,
  Inbox,
  Loader2,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror server-side shapes (loose, since RabbitMQ mgmt API is broad)
// ─────────────────────────────────────────────────────────────────────────────

interface RateBlock {
  rate?: number;
}

interface QueueDetail {
  queue: {
    name: string;
    vhost: string;
    state?: string;
    durable?: boolean;
    auto_delete?: boolean;
    exclusive?: boolean;
    node?: string;
    type?: string;
    messages?: number;
    messages_ready?: number;
    messages_unacknowledged?: number;
    consumers?: number;
    memory?: number;
    message_bytes?: number;
    message_bytes_ready?: number;
    message_bytes_unacknowledged?: number;
    arguments?: Record<string, unknown>;
    policy?: string;
    idle_since?: string;
    message_stats?: {
      publish?: number;
      publish_details?: RateBlock;
      deliver?: number;
      deliver_details?: RateBlock;
      deliver_get?: number;
      deliver_get_details?: RateBlock;
      ack?: number;
      ack_details?: RateBlock;
      redeliver?: number;
      redeliver_details?: RateBlock;
    };
  };
  node?: string;
  vhost: string;
}

interface Binding {
  source: string;
  vhost: string;
  destination: string;
  destinationType: string;
  routingKey: string;
  arguments: Record<string, unknown>;
  propertiesKey?: string;
}

interface ConsumerDetail {
  consumerTag: string;
  ackRequired: boolean;
  active: boolean;
  exclusive: boolean;
  prefetchCount: number;
  channelName?: string;
  connectionName?: string;
  peerHost?: string;
  peerPort?: number;
  user?: string;
  arguments: Record<string, unknown>;
}

interface PeekedMessage {
  payload: string;
  payloadBytes?: number;
  payloadEncoding: string;
  routingKey: string;
  exchange: string;
  redelivered: boolean;
  properties: Record<string, unknown>;
  messageCount?: number;
}

interface Props {
  connectionId: string;
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function formatRate(r: number | undefined): string {
  if (!r || !Number.isFinite(r)) return "0 msg/s";
  if (r < 10) return `${r.toFixed(2)} msg/s`;
  if (r < 1000) return `${r.toFixed(1)} msg/s`;
  return `${formatCompact(r)} msg/s`;
}

function severityTone(messages: number): "ok" | "warn" | "high" {
  if (messages < 1_000) return "ok";
  if (messages < 100_000) return "warn";
  return "high";
}

export function QueueDetailClient({ connectionId, name }: Props) {
  const router = useRouter();
  const base = `/api/rabbit/${connectionId}/queues/${encodeURIComponent(name)}`;

  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState<QueueDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const [consumers, setConsumers] = useState<ConsumerDetail[] | null>(null);

  const [peekCount, setPeekCount] = useState("10");
  const [requeue, setRequeue] = useState(true);
  const [peeking, setPeeking] = useState(false);
  const [peeked, setPeeked] = useState<PeekedMessage[] | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<PeekedMessage | null>(
    null
  );

  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadDetail = useCallback(async () => {
    setDetailErr(null);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDetail(data as QueueDetail);
      else {
        setDetailErr(data.error || "Could not load queue");
        toast.error("Could not load", { description: data.error });
      }
    } catch (err) {
      setDetailErr((err as Error).message);
    }
  }, [base]);

  const loadBindings = useCallback(async () => {
    setBindings(null);
    try {
      const res = await fetch(`${base}/bindings`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setBindings(data.bindings as Binding[]);
      else toast.error("Could not load bindings", { description: data.error });
    } catch (err) {
      toast.error("Could not load bindings", {
        description: (err as Error).message,
      });
    }
  }, [base]);

  const loadConsumers = useCallback(async () => {
    setConsumers(null);
    try {
      const res = await fetch(`${base}/consumers`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setConsumers(data.consumers as ConsumerDetail[]);
      else
        toast.error("Could not load consumers", { description: data.error });
    } catch (err) {
      toast.error("Could not load consumers", {
        description: (err as Error).message,
      });
    }
  }, [base]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // 15s auto-refresh of overview detail
  useEffect(() => {
    const id = setInterval(() => {
      loadDetail();
    }, 15_000);
    return () => clearInterval(id);
  }, [loadDetail]);

  useEffect(() => {
    if (tab === "bindings" && bindings === null) loadBindings();
  }, [tab, bindings, loadBindings]);

  useEffect(() => {
    if (tab === "consumers" && consumers === null) loadConsumers();
  }, [tab, consumers, loadConsumers]);

  const peek = async () => {
    const n = Math.max(1, Math.min(100, Math.floor(Number(peekCount) || 10)));
    setPeeking(true);
    try {
      const res = await fetch(`${base}/get`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: n, requeue }),
      });
      const data = await res.json();
      if (res.ok) {
        setPeeked(data.messages as PeekedMessage[]);
        // After a non-requeue peek, the queue stats just changed — refresh.
        if (!requeue) loadDetail();
      } else {
        toast.error("Could not peek", { description: data.error });
      }
    } finally {
      setPeeking(false);
    }
  };

  const purge = async () => {
    setBusy(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "purge" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Queue purged");
        loadDetail();
      } else toast.error(data.error || "Could not purge");
    } finally {
      setBusy(false);
      setConfirmPurge(false);
    }
  };

  const deleteQueue = async () => {
    setBusy(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Queue deleted");
        router.push(`/rabbit/${connectionId}/queues`);
      } else toast.error(data.error || "Could not delete");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const q = detail?.queue;
  const showVhost = detail && detail.vhost !== "/";
  const messages = q?.messages ?? 0;
  const ready = q?.messages_ready ?? 0;
  const unacked = q?.messages_unacknowledged ?? 0;
  const consumerCount = q?.consumers ?? 0;
  const tone = severityTone(messages);

  return (
    <WorkspacePage
      title={
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-mono truncate">{name}</span>
          {showVhost ? (
            <Badge
              variant="outline"
              className="font-mono text-[10px] tracking-wider"
            >
              {detail!.vhost}
            </Badge>
          ) : null}
          {q ? <StatePill state={q.state ?? "unknown"} /> : null}
          {q?.durable ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider"
              title="Survives broker restart"
            >
              D
            </Badge>
          ) : null}
          {q?.auto_delete ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider"
              title="Auto-delete when unused"
            >
              AD
            </Badge>
          ) : null}
          {q?.exclusive ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider"
              title="Exclusive to declaring connection"
            >
              X
            </Badge>
          ) : null}
        </span>
      }
      description={
        q
          ? `${formatCompact(messages)} msg · ${consumerCount} consumer${consumerCount === 1 ? "" : "s"}${q.node ? ` · ${q.node}` : ""}`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/rabbit/${connectionId}/queues`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={loadDetail}
            disabled={busy}
          >
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmPurge(true)}
            disabled={busy}
          >
            <Eraser className="size-3.5" />
            Purge
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
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="bindings">
            Bindings
            {bindings ? (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {bindings.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="consumers">
            Consumers
            {consumers ? (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {consumers.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="peek">Peek</TabsTrigger>
        </TabsList>

        {/* ── Overview ──────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="pt-4 space-y-4">
          {detailErr ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {detailErr}
            </div>
          ) : null}
          {!q ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile
                  label="Total"
                  value={formatCompact(messages)}
                  hint={q.message_bytes ? formatBytes(q.message_bytes) : undefined}
                  tone={tone}
                />
                <StatTile
                  label="Ready"
                  value={formatCompact(ready)}
                  hint={
                    q.message_bytes_ready
                      ? formatBytes(q.message_bytes_ready)
                      : undefined
                  }
                  accent="emerald"
                />
                <StatTile
                  label="Unacked"
                  value={formatCompact(unacked)}
                  hint={
                    q.message_bytes_unacknowledged
                      ? formatBytes(q.message_bytes_unacknowledged)
                      : undefined
                  }
                  accent="amber"
                />
                <StatTile
                  label="Consumers"
                  value={consumerCount.toString()}
                  hint={q.type ?? undefined}
                  accent="sky"
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-border/60 p-4 space-y-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    Message rates
                  </p>
                  <RateBar
                    label="Publish"
                    rate={q.message_stats?.publish_details?.rate}
                    total={q.message_stats?.publish}
                    color="bg-sky-500/70"
                  />
                  <RateBar
                    label="Deliver"
                    rate={q.message_stats?.deliver_details?.rate}
                    total={q.message_stats?.deliver}
                    color="bg-violet-500/70"
                  />
                  <RateBar
                    label="Ack"
                    rate={q.message_stats?.ack_details?.rate}
                    total={q.message_stats?.ack}
                    color="bg-emerald-500/70"
                  />
                  <RateBar
                    label="Redeliver"
                    rate={q.message_stats?.redeliver_details?.rate}
                    total={q.message_stats?.redeliver}
                    color="bg-rose-500/70"
                  />
                </div>

                <div className="rounded-lg border border-border/60 p-4 space-y-2">
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    Configuration
                  </p>
                  <DefRow
                    label="Vhost"
                    value={<span className="font-mono">{detail.vhost}</span>}
                  />
                  <DefRow
                    label="Type"
                    value={<span className="font-mono">{q.type ?? "classic"}</span>}
                  />
                  <DefRow
                    label="Durable"
                    value={<BoolBadge value={Boolean(q.durable)} />}
                  />
                  <DefRow
                    label="Auto-delete"
                    value={<BoolBadge value={Boolean(q.auto_delete)} />}
                  />
                  <DefRow
                    label="Exclusive"
                    value={<BoolBadge value={Boolean(q.exclusive)} />}
                  />
                  <DefRow
                    label="Node"
                    value={
                      <span className="font-mono text-xs">
                        {q.node ?? "—"}
                      </span>
                    }
                  />
                  {q.policy ? (
                    <DefRow
                      label="Policy"
                      value={<span className="font-mono">{q.policy}</span>}
                    />
                  ) : null}
                  {q.idle_since ? (
                    <DefRow
                      label="Idle since"
                      value={
                        <span className="text-xs">
                          <RelativeTime value={q.idle_since} />
                        </span>
                      }
                    />
                  ) : null}
                  {q.memory ? (
                    <DefRow
                      label="Memory"
                      value={
                        <span className="font-mono text-xs">
                          {formatBytes(q.memory)}
                        </span>
                      }
                    />
                  ) : null}
                  {q.arguments && Object.keys(q.arguments).length > 0 ? (
                    <div className="pt-2">
                      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-1">
                        Arguments
                      </p>
                      <pre className="rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] font-mono whitespace-pre-wrap break-all">
                        {JSON.stringify(q.arguments, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Bindings ──────────────────────────────────────────────────── */}
        <TabsContent value="bindings" className="pt-4 space-y-3">
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={loadBindings}
              disabled={bindings === null}
            >
              <RefreshCcw className="size-3.5" />
              Refresh
            </Button>
          </div>
          {bindings === null ? (
            <Skeleton className="h-32 w-full" />
          ) : bindings.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              No bindings yet.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left">Source exchange</th>
                    <th className="px-3 py-2 text-left">Routing key</th>
                    <th className="px-3 py-2 text-left">Arguments</th>
                  </tr>
                </thead>
                <tbody>
                  {bindings.map((b, i) => (
                    <tr
                      key={`${b.source}-${b.routingKey}-${i}`}
                      className="border-t border-border/40 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 align-middle font-mono">
                        {b.source ? (
                          b.source
                        ) : (
                          <span
                            className="text-muted-foreground"
                            title="Default exchange"
                          >
                            (default)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono">
                        {b.routingKey || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {Object.keys(b.arguments).length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <code className="text-[10px] font-mono">
                            {JSON.stringify(b.arguments)}
                          </code>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Consumers ─────────────────────────────────────────────────── */}
        <TabsContent value="consumers" className="pt-4 space-y-3">
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={loadConsumers}
              disabled={consumers === null}
            >
              <RefreshCcw className="size-3.5" />
              Refresh
            </Button>
          </div>
          {consumers === null ? (
            <Skeleton className="h-32 w-full" />
          ) : consumers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              No consumers attached to this queue.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left">Consumer tag</th>
                    <th className="px-3 py-2 text-left">Channel</th>
                    <th className="px-3 py-2 text-left">Peer</th>
                    <th className="px-3 py-2 text-left w-[80px]">Ack</th>
                    <th className="px-3 py-2 text-left w-[100px]">Prefetch</th>
                    <th className="px-3 py-2 text-left w-[80px]">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {consumers.map((c) => (
                    <tr
                      key={c.consumerTag}
                      className="border-t border-border/40 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 align-middle font-mono break-all">
                        {c.consumerTag}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-[11px] text-muted-foreground break-all">
                        {c.channelName ?? "—"}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-[11px] text-muted-foreground">
                        {c.peerHost
                          ? `${c.peerHost}${c.peerPort ? `:${c.peerPort}` : ""}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <BoolBadge value={c.ackRequired} />
                      </td>
                      <td className="px-3 py-2 align-middle font-mono tabular-nums">
                        {c.prefetchCount}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <ActiveDot active={c.active} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Peek ──────────────────────────────────────────────────────── */}
        <TabsContent value="peek" className="pt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label
                htmlFor="peek-count"
                className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
              >
                Count
              </Label>
              <Input
                id="peek-count"
                type="number"
                min={1}
                max={100}
                value={peekCount}
                onChange={(e) => setPeekCount(e.target.value)}
                className="h-8 w-20 text-xs font-mono"
              />
            </div>
            <div className="flex items-center gap-2 h-8">
              <Switch
                id="requeue"
                size="sm"
                checked={requeue}
                onCheckedChange={setRequeue}
              />
              <Label
                htmlFor="requeue"
                className="cursor-pointer text-xs font-normal text-muted-foreground"
              >
                Requeue after peek
              </Label>
            </div>
            <Button size="sm" onClick={peek} disabled={peeking}>
              {peeking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Search className="size-3.5" />
              )}
              Peek
            </Button>
            <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              up to 100 · ack {requeue ? "requeue" : "DROP"}
            </span>
          </div>

          {!requeue ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5 shrink-0" />
              Messages will be{" "}
              <span className="font-semibold">removed from the queue</span>{" "}
              after peek. Toggle the switch to keep them.
            </div>
          ) : null}

          {peeked === null ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              <Inbox className="size-5 mx-auto mb-2 opacity-60" />
              Click <span className="font-mono">Peek</span> to inspect messages.
            </div>
          ) : peeked.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              Queue is empty (or all messages already in flight to consumers).
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-auto max-h-[60vh]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left w-10">#</th>
                    <th className="px-3 py-2 text-left w-[28%]">Routing key</th>
                    <th className="px-3 py-2 text-left w-[18%]">Exchange</th>
                    <th className="px-3 py-2 text-left w-[16%]">Encoding</th>
                    <th className="px-3 py-2 text-left">Preview</th>
                    <th className="px-3 py-2 text-left w-12">Re</th>
                  </tr>
                </thead>
                <tbody>
                  {peeked.map((m, i) => (
                    <tr
                      key={i}
                      onClick={() => setSelectedMessage(m)}
                      className="border-t border-border/30 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-3 py-1.5 align-top tabular-nums text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="px-3 py-1.5 align-top truncate max-w-0">
                        {m.routingKey || (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top truncate max-w-0">
                        {m.exchange ? (
                          m.exchange
                        ) : (
                          <span
                            className="text-muted-foreground"
                            title="Default exchange"
                          >
                            (default)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top text-[10px] text-muted-foreground">
                        {m.payloadEncoding}
                        {m.payloadBytes ? (
                          <span className="ml-1">
                            · {formatBytes(m.payloadBytes)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 align-top truncate max-w-0">
                        <span className="block truncate">
                          {m.payloadEncoding === "string"
                            ? m.payload
                            : `<${m.payloadEncoding}>`}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        {m.redelivered ? (
                          <span className="text-rose-600 dark:text-rose-400">
                            ●
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">○</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmPurge} onOpenChange={setConfirmPurge}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Purge queue?</AlertDialogTitle>
            <AlertDialogDescription>
              All messages currently in <span className="font-mono">{name}</span>{" "}
              will be discarded. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={purge}>Purge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete queue?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-mono">{name}</span> and all its bindings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteQueue}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PeekedMessageSheet
        message={selectedMessage}
        queueName={name}
        onClose={() => setSelectedMessage(null)}
      />
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small components
// ─────────────────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  hint,
  tone,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "high";
  accent?: "emerald" | "amber" | "sky";
}) {
  const accentCls =
    tone === "high"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : accent === "emerald"
          ? "text-emerald-600 dark:text-emerald-400"
          : accent === "amber"
            ? "text-amber-600 dark:text-amber-400"
            : accent === "sky"
              ? "text-sky-600 dark:text-sky-400"
              : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 p-4">
      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-mono font-semibold tabular-nums",
          accentCls
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function RateBar({
  label,
  rate,
  total,
  color,
}: {
  label: string;
  rate: number | undefined;
  total: number | undefined;
  color: string;
}) {
  const r = rate ?? 0;
  // 50 msg/s = full bar — clamp to visualise.
  const pct = Math.min(100, (r / 50) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono tabular-nums">
          {formatRate(r)}
          {total ? (
            <span className="text-muted-foreground ml-2">
              ({formatCompact(total)} total)
            </span>
          ) : null}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DefRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function BoolBadge({ value }: { value: boolean }) {
  return value ? (
    <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
      true
    </span>
  ) : (
    <span className="text-muted-foreground font-mono text-[11px]">false</span>
  );
}

function ActiveDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider",
        active
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-muted-foreground"
        )}
      />
      {active ? "active" : "idle"}
    </span>
  );
}

function StatePill({ state }: { state: string }) {
  const s = state.toLowerCase();
  const cls =
    s === "running"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : s === "idle"
        ? "border-border/60 bg-muted/40 text-muted-foreground"
        : s === "flow"
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
          s === "running"
            ? "bg-emerald-500"
            : s === "flow"
              ? "bg-amber-500"
              : "bg-muted-foreground"
        )}
      />
      {s || "unknown"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message drawer (Sheet)
// ─────────────────────────────────────────────────────────────────────────────

function PeekedMessageSheet({
  message,
  queueName,
  onClose,
}: {
  message: PeekedMessage | null;
  queueName: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={Boolean(message)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <span className="font-mono">{queueName}</span>
            {message ? (
              <span className="text-xs font-mono text-muted-foreground">
                · {message.exchange || "(default)"} →{" "}
                {message.routingKey || "—"}
                {message.redelivered ? (
                  <span className="ml-2 text-rose-600 dark:text-rose-400">
                    REDELIVERED
                  </span>
                ) : null}
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>
        {message ? (
          <div className="flex-1 min-h-0 overflow-auto p-5 space-y-5">
            <MetaRow label="Exchange">
              <span className="font-mono text-xs">
                {message.exchange || "(default)"}
              </span>
            </MetaRow>
            <MetaRow label="Routing key">
              <span className="font-mono text-xs">
                {message.routingKey || "—"}
              </span>
            </MetaRow>
            <MetaRow label="Encoding">
              <span className="font-mono text-xs">
                {message.payloadEncoding}
              </span>
            </MetaRow>
            {message.payloadBytes ? (
              <MetaRow label="Size">
                <span className="font-mono text-xs">
                  {formatBytes(message.payloadBytes)}
                </span>
              </MetaRow>
            ) : null}
            {message.messageCount !== undefined ? (
              <MetaRow label="Remaining">
                <span className="font-mono text-xs">
                  {message.messageCount.toLocaleString()} messages still in
                  queue
                </span>
              </MetaRow>
            ) : null}

            <PayloadBlock
              label="Payload"
              content={message.payload}
              encoding={message.payloadEncoding}
            />

            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Properties
              </p>
              {Object.keys(message.properties).length === 0 ? (
                <p className="text-xs text-muted-foreground">No properties.</p>
              ) : (
                <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[30vh] overflow-auto">
                  {JSON.stringify(message.properties, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground w-24 shrink-0">
        {label}
      </span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

function PayloadBlock({
  label,
  content,
  encoding,
}: {
  label: string;
  content: string;
  encoding: string;
}) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => prettyPrintJson(content), [content]);
  const isJson = pretty !== content && content.length > 0;
  const isBase64 = encoding === "base64";
  const ref = useRef<HTMLPreElement>(null);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {label}
          {isJson ? (
            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 normal-case tracking-normal">
              json
            </span>
          ) : null}
          {isBase64 ? (
            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 normal-case tracking-normal">
              base64
            </span>
          ) : null}
        </p>
        <Button size="xs" variant="ghost" onClick={onCopy} className="h-6 px-2">
          {copied ? (
            <Check className="size-3" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? "copied" : "copy"}
        </Button>
      </div>
      {content.length === 0 ? (
        <p className="text-xs text-muted-foreground">empty</p>
      ) : (
        <pre
          ref={ref}
          className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[40vh] overflow-auto"
        >
          {pretty}
        </pre>
      )}
    </div>
  );
}

function prettyPrintJson(s: string): string {
  const trimmed = s.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // fall through
    }
  }
  return s;
}
