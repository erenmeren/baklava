"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
  ArrowLeft,
  Check,
  Copy,
  Eraser,
  Inbox,
  Loader2,
  RefreshCcw,
  Trash2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror server-side shapes
// ─────────────────────────────────────────────────────────────────────────────

interface StreamPeer {
  name: string;
  current: boolean;
  offline: boolean;
  lag?: number;
  active?: number;
}

interface StreamDetail {
  name: string;
  created?: string;
  description?: string;
  config: {
    subjects: string[];
    retention: string;
    storage: string;
    discard: string;
    maxAge: number;
    maxMsgs: number;
    maxMsgsPerSubject: number;
    maxBytes: number;
    maxMsgSize: number;
    maxConsumers: number;
    numReplicas: number;
    duplicateWindow: number;
    sealed: boolean;
    denyDelete: boolean;
    denyPurge: boolean;
    allowRollup: boolean;
    firstSeq: number;
  };
  state: {
    messages: number;
    bytes: number;
    firstSeq: number;
    lastSeq: number;
    firstTs?: string;
    lastTs?: string;
    consumerCount: number;
    numSubjects: number;
    numDeleted: number;
    subjects?: Record<string, number>;
  };
  cluster?: {
    name?: string;
    leader?: string;
    replicas: StreamPeer[];
  };
}

interface ConsumerSummary {
  name: string;
  streamName: string;
  durable: boolean;
  durableName?: string;
  ackPolicy: string;
  deliverPolicy: string;
  replayPolicy: string;
  filterSubject?: string;
  numPending: number;
  numAckPending: number;
  numRedelivered: number;
  numWaiting: number;
  lastDeliveredSeq: number;
  ackFloorSeq: number;
  created?: string;
  pushBound: boolean;
  paused: boolean;
}

interface StoredMessage {
  seq: number;
  subject: string;
  ts?: string;
  headers: Record<string, string[]>;
  payload: string;
  payloadBase64?: string;
  size: number;
  isUtf8: boolean;
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

function formatAgeNanos(ns: number): string {
  if (!ns) return "∞";
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

export function StreamDetailClient({ connectionId, name }: Props) {
  const router = useRouter();
  const base = `/api/nats/${connectionId}/streams/${encodeURIComponent(name)}`;

  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState<StreamDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [consumers, setConsumers] = useState<ConsumerSummary[] | null>(null);

  const [messages, setMessages] = useState<StoredMessage[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<StoredMessage | null>(
    null
  );

  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadDetail = useCallback(async () => {
    setDetailErr(null);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDetail(data.stream as StreamDetail);
      else {
        setDetailErr(data.error || "Could not load stream");
        toast.error("Could not load", { description: data.error });
      }
    } catch (err) {
      setDetailErr((err as Error).message);
    }
  }, [base]);

  const loadConsumers = useCallback(async () => {
    setConsumers(null);
    try {
      const res = await fetch(`${base}/consumers`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setConsumers(data.consumers as ConsumerSummary[]);
      else
        toast.error("Could not load consumers", { description: data.error });
    } catch (err) {
      toast.error("Could not load consumers", {
        description: (err as Error).message,
      });
    }
  }, [base]);

  const loadMessages = useCallback(
    async (count: number) => {
      const n = Math.min(100, Math.max(1, count));
      setLoadingMessages(true);
      try {
        const res = await fetch(`${base}/messages?count=${n}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (res.ok) setMessages(data.messages as StoredMessage[]);
        else
          toast.error("Could not load messages", { description: data.error });
      } finally {
        setLoadingMessages(false);
      }
    },
    [base]
  );

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // 15s auto-refresh on overview
  useEffect(() => {
    const id = setInterval(() => {
      loadDetail();
    }, 15_000);
    return () => clearInterval(id);
  }, [loadDetail]);

  useEffect(() => {
    if (tab === "consumers" && consumers === null) loadConsumers();
  }, [tab, consumers, loadConsumers]);

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
        toast.success("Stream purged");
        loadDetail();
        setMessages(null);
      } else toast.error(data.error || "Could not purge");
    } finally {
      setBusy(false);
      setConfirmPurge(false);
    }
  };

  const deleteStream = async () => {
    setBusy(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Stream deleted");
        router.push(`/nats/${connectionId}/streams`);
      } else toast.error(data.error || "Could not delete");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const totalMessages = detail?.state.messages ?? 0;
  const tone = severityTone(totalMessages);
  const isEmpty = !detail || totalMessages === 0;

  return (
    <WorkspacePage
      title={
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-mono truncate">{name}</span>
          {detail ? <RetentionPill value={detail.config.retention} /> : null}
          {detail ? <StoragePill value={detail.config.storage} /> : null}
          {detail ? (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider"
              title={`Replicas: ${detail.config.numReplicas}`}
            >
              R{detail.config.numReplicas}
            </Badge>
          ) : null}
          {detail ? <StateActivePill empty={isEmpty} /> : null}
        </span>
      }
      description={
        detail
          ? `${formatCompact(totalMessages)} msg · ${formatBytes(detail.state.bytes)} · ${detail.state.consumerCount} consumer${detail.state.consumerCount === 1 ? "" : "s"}`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/nats/${connectionId}/streams`}
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
          <TabsTrigger value="subjects">
            Subjects
            {detail ? (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {detail.config.subjects.length}
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
          <TabsTrigger value="messages">Messages</TabsTrigger>
        </TabsList>

        {/* ── Overview ──────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="pt-4 space-y-4">
          {detailErr ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {detailErr}
            </div>
          ) : null}
          {!detail ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile
                  label="Messages"
                  value={formatCompact(detail.state.messages)}
                  hint={
                    detail.state.numDeleted
                      ? `${formatCompact(detail.state.numDeleted)} deleted`
                      : undefined
                  }
                  tone={tone}
                />
                <StatTile
                  label="Bytes"
                  value={formatBytes(detail.state.bytes)}
                  hint={
                    detail.config.maxBytes
                      ? `max ${formatBytes(detail.config.maxBytes)}`
                      : undefined
                  }
                  accent="sky"
                />
                <StatTile
                  label="First seq"
                  value={formatCompact(detail.state.firstSeq)}
                  hint={
                    detail.state.firstTs ? (
                      <RelativeTime value={detail.state.firstTs} />
                    ) : undefined
                  }
                />
                <StatTile
                  label="Last seq"
                  value={formatCompact(detail.state.lastSeq)}
                  hint={
                    detail.state.lastTs ? (
                      <RelativeTime value={detail.state.lastTs} />
                    ) : undefined
                  }
                  accent="emerald"
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-border/60 p-4 space-y-2">
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    Configuration
                  </p>
                  <DefRow
                    label="Retention"
                    value={<RetentionPill value={detail.config.retention} />}
                  />
                  <DefRow
                    label="Storage"
                    value={<StoragePill value={detail.config.storage} />}
                  />
                  <DefRow
                    label="Discard"
                    value={
                      <span className="font-mono text-xs">
                        {detail.config.discard || "—"}
                      </span>
                    }
                  />
                  <DefRow
                    label="Max age"
                    value={
                      <span className="font-mono text-xs">
                        {formatAgeNanos(detail.config.maxAge)}
                      </span>
                    }
                  />
                  <DefRow
                    label="Max msgs"
                    value={
                      <span className="font-mono text-xs">
                        {detail.config.maxMsgs > 0
                          ? formatCompact(detail.config.maxMsgs)
                          : "∞"}
                      </span>
                    }
                  />
                  <DefRow
                    label="Max bytes"
                    value={
                      <span className="font-mono text-xs">
                        {detail.config.maxBytes > 0
                          ? formatBytes(detail.config.maxBytes)
                          : "∞"}
                      </span>
                    }
                  />
                  <DefRow
                    label="Max msg size"
                    value={
                      <span className="font-mono text-xs">
                        {detail.config.maxMsgSize > 0
                          ? formatBytes(detail.config.maxMsgSize)
                          : "∞"}
                      </span>
                    }
                  />
                  <DefRow
                    label="Replicas"
                    value={
                      <span className="font-mono text-xs">
                        {detail.config.numReplicas}
                      </span>
                    }
                  />
                  <DefRow
                    label="Dup window"
                    value={
                      <span className="font-mono text-xs">
                        {formatAgeNanos(detail.config.duplicateWindow)}
                      </span>
                    }
                  />
                  {detail.config.sealed ? (
                    <DefRow
                      label="Sealed"
                      value={
                        <span className="text-amber-600 dark:text-amber-400 font-mono text-[11px]">
                          true
                        </span>
                      }
                    />
                  ) : null}
                  {detail.created ? (
                    <DefRow
                      label="Created"
                      value={
                        <span className="text-xs">
                          <RelativeTime value={detail.created} />
                        </span>
                      }
                    />
                  ) : null}
                </div>

                <div className="rounded-lg border border-border/60 p-4 space-y-2">
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    Cluster
                  </p>
                  {!detail.cluster ? (
                    <p className="text-xs text-muted-foreground">
                      Not clustered (single-node).
                    </p>
                  ) : (
                    <>
                      {detail.cluster.name ? (
                        <DefRow
                          label="Name"
                          value={
                            <span className="font-mono text-xs">
                              {detail.cluster.name}
                            </span>
                          }
                        />
                      ) : null}
                      <DefRow
                        label="Leader"
                        value={
                          <span className="font-mono text-xs">
                            {detail.cluster.leader ?? "—"}
                          </span>
                        }
                      />
                      <div className="pt-2">
                        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-1">
                          Replicas
                        </p>
                        {detail.cluster.replicas.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No replicas reporting.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {detail.cluster.replicas.map((r) => (
                              <div
                                key={r.name}
                                className="flex items-center justify-between text-xs font-mono"
                              >
                                <span>{r.name}</span>
                                <span className="flex items-center gap-1.5">
                                  {r.offline ? (
                                    <span className="text-rose-600 dark:text-rose-400">
                                      offline
                                    </span>
                                  ) : r.current ? (
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      current
                                    </span>
                                  ) : (
                                    <span className="text-amber-600 dark:text-amber-400">
                                      lag {r.lag ?? 0}
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Subjects ──────────────────────────────────────────────────── */}
        <TabsContent value="subjects" className="pt-4 space-y-3">
          {!detail ? (
            <Skeleton className="h-32 w-full" />
          ) : detail.config.subjects.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              No subjects bound to this stream.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left">Subject pattern</th>
                    <th className="px-3 py-2 text-left w-[30%]">
                      Live counts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.config.subjects.map((s) => {
                    const matching = matchSubjectCounts(
                      s,
                      detail.state.subjects
                    );
                    return (
                      <tr
                        key={s}
                        className="border-t border-border/40 hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 align-top font-mono">{s}</td>
                        <td className="px-3 py-2 align-top">
                          {matching.length === 0 ? (
                            <span className="text-muted-foreground">
                              {detail.state.subjects ? "0 messages" : "—"}
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              {matching.slice(0, 6).map(([sub, n]) => (
                                <div
                                  key={sub}
                                  className="flex items-center justify-between gap-2 font-mono text-[11px]"
                                >
                                  <span className="truncate">{sub}</span>
                                  <span className="tabular-nums text-muted-foreground">
                                    {formatCompact(n)}
                                  </span>
                                </div>
                              ))}
                              {matching.length > 6 ? (
                                <p className="text-[10px] font-mono text-muted-foreground">
                                  +{matching.length - 6} more
                                </p>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
              No consumers attached to this stream.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left w-[90px]">Type</th>
                    <th className="px-3 py-2 text-left w-[100px]">Ack</th>
                    <th className="px-3 py-2 text-left w-[120px]">Deliver</th>
                    <th className="px-3 py-2 text-right w-[80px]">Pending</th>
                    <th className="px-3 py-2 text-right w-[80px]">Unacked</th>
                    <th className="px-3 py-2 text-right w-[80px]">Waiting</th>
                    <th className="px-3 py-2 text-right w-[100px]">
                      Last seq
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {consumers.map((c) => (
                    <tr
                      key={c.name}
                      className="border-t border-border/40 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 align-middle font-mono break-all">
                        {c.name}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {c.durable ? (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono uppercase"
                          >
                            durable
                          </Badge>
                        ) : (
                          <span className="text-[10px] font-mono uppercase text-muted-foreground">
                            ephemeral
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-[11px] text-muted-foreground">
                        {c.ackPolicy}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-[11px] text-muted-foreground">
                        {c.deliverPolicy}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono tabular-nums text-right">
                        {formatCompact(c.numPending)}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono tabular-nums text-right">
                        {formatCompact(c.numAckPending)}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono tabular-nums text-right">
                        {formatCompact(c.numWaiting)}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono tabular-nums text-right text-muted-foreground">
                        {formatCompact(c.lastDeliveredSeq)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Messages ──────────────────────────────────────────────────── */}
        <TabsContent value="messages" className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadMessages(10)}
              disabled={loadingMessages}
            >
              {loadingMessages ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Inbox className="size-3.5" />
              )}
              Get last 10
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadMessages(50)}
              disabled={loadingMessages}
            >
              {loadingMessages ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Inbox className="size-3.5" />
              )}
              Get last 50
            </Button>
            {messages ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => loadMessages(messages.length || 10)}
                disabled={loadingMessages}
              >
                <RefreshCcw className="size-3.5" />
                Refresh
              </Button>
            ) : null}
            <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              read-only · capped at 100
            </span>
          </div>

          {messages === null ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              <Inbox className="size-5 mx-auto mb-2 opacity-60" />
              Click a button above to fetch messages.
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              Stream is empty.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-auto max-h-[60vh]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left w-20">Seq</th>
                    <th className="px-3 py-2 text-left w-[36%]">Subject</th>
                    <th className="px-3 py-2 text-left w-44">Time</th>
                    <th className="px-3 py-2 text-left w-16">Size</th>
                    <th className="px-3 py-2 text-left">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr
                      key={m.seq}
                      onClick={() => setSelectedMessage(m)}
                      className="border-t border-border/30 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-3 py-1.5 align-top tabular-nums text-muted-foreground">
                        {m.seq}
                      </td>
                      <td className="px-3 py-1.5 align-top truncate max-w-0">
                        {m.subject}
                      </td>
                      <td className="px-3 py-1.5 align-top text-muted-foreground tabular-nums whitespace-nowrap">
                        {m.ts ? formatTimeShort(m.ts) : "—"}
                      </td>
                      <td className="px-3 py-1.5 align-top text-muted-foreground">
                        {m.size}
                      </td>
                      <td className="px-3 py-1.5 align-top truncate max-w-0">
                        <span className="block truncate">
                          {m.isUtf8 ? (
                            m.payload
                          ) : (
                            <span className="text-muted-foreground">
                              &lt;binary {m.size}B&gt;
                            </span>
                          )}
                        </span>
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
            <AlertDialogTitle>Purge stream?</AlertDialogTitle>
            <AlertDialogDescription>
              All messages currently in{" "}
              <span className="font-mono">{name}</span> will be discarded. The
              stream configuration is preserved.
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
            <AlertDialogTitle>Delete stream?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-mono">{name}</span>, all of its messages,
              and all attached consumers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteStream}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StoredMessageSheet
        message={selectedMessage}
        streamName={name}
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
  hint?: React.ReactNode;
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

function StateActivePill({ empty }: { empty: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider",
        empty
          ? "border-border/60 bg-muted/40 text-muted-foreground"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      )}
    >
      <span
        className={cn(
          "size-1 rounded-full",
          empty ? "bg-muted-foreground" : "bg-emerald-500"
        )}
      />
      {empty ? "empty" : "active"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message drawer (Sheet)
// ─────────────────────────────────────────────────────────────────────────────

function StoredMessageSheet({
  message,
  streamName,
  onClose,
}: {
  message: StoredMessage | null;
  streamName: string;
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
            <span className="font-mono">{streamName}</span>
            {message ? (
              <span className="text-xs font-mono text-muted-foreground">
                · @{message.seq}
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>
        {message ? (
          <div className="flex-1 min-h-0 overflow-auto p-5 space-y-5">
            <MetaRow label="Subject">
              <span className="font-mono text-xs">{message.subject}</span>
            </MetaRow>
            <MetaRow label="Seq">
              <span className="font-mono text-xs">{message.seq}</span>
            </MetaRow>
            <MetaRow label="Size">
              <span className="font-mono text-xs">
                {message.size} B
                {message.size >= 1024
                  ? ` (${formatBytes(message.size)})`
                  : ""}
              </span>
            </MetaRow>
            {message.ts ? (
              <MetaRow label="Timestamp">
                <span className="font-mono text-xs">
                  {message.ts}
                  <span className="ml-2 text-muted-foreground">
                    <RelativeTime value={message.ts} />
                  </span>
                </span>
              </MetaRow>
            ) : null}

            <PayloadBlock message={message} />

            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Headers
              </p>
              {Object.keys(message.headers).length === 0 ? (
                <p className="text-xs text-muted-foreground">No headers.</p>
              ) : (
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <table className="w-full text-xs font-mono">
                    <tbody>
                      {Object.entries(message.headers).map(([k, vs]) => (
                        <tr
                          key={k}
                          className="border-b border-border/40 last:border-b-0"
                        >
                          <td className="px-3 py-1.5 text-muted-foreground align-top w-1/3 break-all">
                            {k}
                          </td>
                          <td className="px-3 py-1.5 break-all">
                            {vs.join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground w-20 shrink-0">
        {label}
      </span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

function PayloadBlock({ message }: { message: StoredMessage }) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(
    () => (message.isUtf8 ? prettyPrintJson(message.payload) : message.payload),
    [message]
  );
  const isJson = message.isUtf8 && pretty !== message.payload;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        message.isUtf8 ? message.payload : message.payloadBase64 ?? ""
      );
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
          Payload
          {isJson ? (
            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 normal-case tracking-normal">
              json
            </span>
          ) : null}
          {!message.isUtf8 ? (
            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 normal-case tracking-normal">
              binary
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
      {!message.isUtf8 ? (
        <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-[40vh] overflow-auto text-muted-foreground">
          {hexPreview(message.payloadBase64 ?? "")}
        </pre>
      ) : message.payload.length === 0 ? (
        <p className="text-xs text-muted-foreground">empty</p>
      ) : (
        <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[40vh] overflow-auto">
          {pretty}
        </pre>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function hexPreview(b64: string): string {
  if (!b64) return "";
  try {
    const bin = atob(b64);
    const bytes: string[] = [];
    const max = Math.min(bin.length, 512);
    for (let i = 0; i < max; i++) {
      bytes.push(bin.charCodeAt(i).toString(16).padStart(2, "0"));
    }
    let out = "";
    for (let i = 0; i < bytes.length; i += 16) {
      out += bytes.slice(i, i + 16).join(" ") + "\n";
    }
    if (bin.length > max) {
      out += `… (${bin.length - max} more bytes)`;
    }
    return out;
  } catch {
    return b64;
  }
}

function formatTimeShort(ts: string): string {
  // Already an ISO string from the server.
  return ts.slice(11, 23);
}

function matchSubjectCounts(
  pattern: string,
  subjects: Record<string, number> | undefined
): [string, number][] {
  if (!subjects) return [];
  const out: [string, number][] = [];
  // Convert NATS subject pattern (token-wildcards * and >) to a regex.
  const tokens = pattern.split(".");
  const re = new RegExp(
    "^" +
      tokens
        .map((t, i) =>
          t === ">"
            ? i === tokens.length - 1
              ? ".+"
              : "[^.]+(?:\\..*)?"
            : t === "*"
              ? "[^.]+"
              : t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        )
        .join("\\.") +
      "$"
  );
  for (const [s, n] of Object.entries(subjects)) {
    if (re.test(s)) out.push([s, n]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}
