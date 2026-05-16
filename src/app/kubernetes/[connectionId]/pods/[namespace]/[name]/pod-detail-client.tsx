"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { DetailBlock } from "@/components/data/detail-block";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCcw,
  Loader2,
  Boxes,
  AlertTriangle,
} from "lucide-react";

interface PodDetail {
  name: string;
  namespace: string;
  phase: string;
  state: "running" | "pending" | "succeeded" | "failed" | "unknown";
  podIp: string | null;
  hostIp: string | null;
  nodeName: string | null;
  serviceAccount: string | null;
  qosClass: string | null;
  createdAt: string | null;
  startTime: string | null;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  conditions: {
    type: string;
    status: string;
    reason?: string;
    message?: string;
    lastTransitionTime: string | null;
  }[];
  containers: {
    name: string;
    image: string;
    ready: boolean;
    restartCount: number;
    state: "running" | "waiting" | "terminated" | "unknown";
    stateReason?: string;
    stateMessage?: string;
    startedAt: string | null;
    ports: { containerPort: number; protocol: string; name?: string }[];
    resources: {
      requestsCpu?: string;
      requestsMemory?: string;
      limitsCpu?: string;
      limitsMemory?: string;
    };
  }[];
  events: {
    type: string;
    reason: string;
    message: string;
    count: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  }[];
  rawYaml: string;
}

interface Props {
  connectionId: string;
  namespace: string;
  name: string;
}

const PHASE_TONES: Record<PodDetail["state"], string> = {
  running:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  pending:
    "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  succeeded:
    "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  unknown: "bg-muted text-muted-foreground border-border/60",
};

const CONTAINER_STATE_TONE: Record<string, string> = {
  running: "bg-emerald-500",
  waiting: "bg-amber-500",
  terminated: "bg-sky-500",
  unknown: "bg-muted",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function PodDetailClient({ connectionId, namespace, name }: Props) {
  const base = `/api/kubernetes/${connectionId}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState<PodDetail | null>(null);
  const [loading, setLoading] = useState(false);

  // logs tab
  const [logs, setLogs] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [container, setContainer] = useState<string | null>(null);
  const [tail, setTail] = useState(500);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setDetail(data as PodDetail);
        if (!container && (data as PodDetail).containers.length > 0) {
          setContainer((data as PodDetail).containers[0].name);
        }
      } else {
        toast.error("Could not load pod", { description: data.error });
      }
    } finally {
      setLoading(false);
    }
  }, [base, container]);

  useEffect(() => {
    load();
  }, [load]);

  // auto-refresh
  useEffect(() => {
    if (tab !== "overview") return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [tab, load]);

  const loadLogs = useCallback(async () => {
    if (!container) return;
    setLogsLoading(true);
    try {
      const url = `${base}/logs?container=${encodeURIComponent(container)}&tail=${tail}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setLogs(data.logs ?? "");
      else toast.error("Could not load logs", { description: data.error });
    } finally {
      setLogsLoading(false);
    }
  }, [base, container, tail]);

  useEffect(() => {
    if (tab === "logs") loadLogs();
  }, [tab, loadLogs]);

  return (
    <WorkspacePage
      title={
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground font-mono">
            {namespace}
          </span>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono">{name}</span>
        </span>
      }
      description={
        detail ? (
          <span className="inline-flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                PHASE_TONES[detail.state]
              )}
            >
              {detail.phase}
            </span>
            <span className="text-xs text-muted-foreground">
              {detail.containers.length} container
              {detail.containers.length === 1 ? "" : "s"} · started{" "}
              {relTime(detail.startTime ?? detail.createdAt)}
            </span>
          </span>
        ) : undefined
      }
      actions={
        <>
          <Link
            href={`/kubernetes/${connectionId}/pods${namespace ? `?ns=${encodeURIComponent(namespace)}` : ""}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCcw
              className={cn("size-3.5", loading && "animate-spin")}
            />
            Refresh
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="containers">
            Containers
            {detail && detail.containers.length > 0 ? (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {detail.containers.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="events">
            Events
            {detail && detail.events.length > 0 ? (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {detail.events.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="yaml">YAML</TabsTrigger>
        </TabsList>

        {/* ── Overview ────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="pt-4 space-y-4">
          {detail === null ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border/60 bg-card p-4 space-y-2">
                <h3 className="text-sm font-semibold mb-2">Details</h3>
                <Meta label="Namespace" value={detail.namespace} mono />
                <Meta label="Node" value={detail.nodeName ?? "—"} mono />
                <Meta label="Pod IP" value={detail.podIp ?? "—"} mono />
                <Meta label="Host IP" value={detail.hostIp ?? "—"} mono />
                <Meta
                  label="Service account"
                  value={detail.serviceAccount ?? "—"}
                  mono
                />
                <Meta label="QoS class" value={detail.qosClass ?? "—"} />
                <Meta
                  label="Created"
                  value={
                    detail.createdAt
                      ? `${new Date(detail.createdAt).toISOString()} (${relTime(detail.createdAt)})`
                      : "—"
                  }
                  mono
                />
              </div>

              <div className="rounded-lg border border-border/60 bg-card p-4">
                <h3 className="text-sm font-semibold mb-2">Conditions</h3>
                {detail.conditions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No conditions.</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.conditions.map((c) => (
                      <div
                        key={c.type}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="font-mono">{c.type}</span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider",
                            c.status === "True"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : c.status === "False"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              c.status === "True"
                                ? "bg-emerald-500"
                                : c.status === "False"
                                  ? "bg-amber-500"
                                  : "bg-muted"
                            )}
                          />
                          {c.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border/60 bg-card p-4 lg:col-span-2">
                <h3 className="text-sm font-semibold mb-2">Labels</h3>
                {Object.keys(detail.labels).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No labels.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(detail.labels).map(([k, v]) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono"
                      >
                        <span className="text-muted-foreground">{k}</span>
                        <span>=</span>
                        <span className="text-foreground">{v}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Containers ──────────────────────────────────────────────── */}
        <TabsContent value="containers" className="pt-4 space-y-3">
          {detail === null ? (
            <Skeleton className="h-32" />
          ) : detail.containers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No containers.</p>
          ) : (
            <div className="space-y-3">
              {detail.containers.map((c) => (
                <div
                  key={c.name}
                  className="rounded-lg border border-border/60 bg-card overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Boxes className="size-4 text-blue-500" />
                      <span className="font-mono text-sm">{c.name}</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider",
                          c.ready
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            CONTAINER_STATE_TONE[c.state]
                          )}
                        />
                        {c.state}
                        {c.stateReason ? ` · ${c.stateReason}` : null}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                      {c.restartCount > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {c.restartCount} restart
                          {c.restartCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {c.startedAt ? <span>up {relTime(c.startedAt)}</span> : null}
                    </div>
                  </div>
                  <div className="px-4 py-3 grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <Meta label="Image" value={c.image} mono />
                    {c.ports.length > 0 ? (
                      <Meta
                        label="Ports"
                        value={c.ports
                          .map(
                            (p) =>
                              `${p.containerPort}/${p.protocol}${p.name ? ` (${p.name})` : ""}`
                          )
                          .join(", ")}
                        mono
                      />
                    ) : null}
                    {c.resources.requestsCpu || c.resources.requestsMemory ? (
                      <Meta
                        label="Requests"
                        value={`cpu=${c.resources.requestsCpu ?? "—"}, mem=${c.resources.requestsMemory ?? "—"}`}
                        mono
                      />
                    ) : null}
                    {c.resources.limitsCpu || c.resources.limitsMemory ? (
                      <Meta
                        label="Limits"
                        value={`cpu=${c.resources.limitsCpu ?? "—"}, mem=${c.resources.limitsMemory ?? "—"}`}
                        mono
                      />
                    ) : null}
                  </div>
                  {c.stateMessage ? (
                    <div className="px-4 pb-3">
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] font-mono text-amber-700 dark:text-amber-300">
                        {c.stateMessage}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Logs ────────────────────────────────────────────────────── */}
        <TabsContent value="logs" className="pt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={container ?? ""}
              onChange={(e) => setContainer(e.target.value)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
            >
              {detail?.containers.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
            >
              {[100, 500, 1000, 5000].map((n) => (
                <option key={n} value={n}>
                  tail {n}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={loadLogs}
              disabled={logsLoading || !container}
            >
              {logsLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
              Fetch
            </Button>
          </div>
          {logs ? (
            <pre className="rounded-md border border-border/60 bg-black text-emerald-200/90 p-3 text-[11px] font-mono whitespace-pre-wrap break-all max-h-[70vh] overflow-auto">
              {logs}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              {logsLoading ? "Reading…" : "No log lines."}
            </p>
          )}
        </TabsContent>

        {/* ── Events ──────────────────────────────────────────────────── */}
        <TabsContent value="events" className="pt-4">
          {detail === null ? (
            <Skeleton className="h-32" />
          ) : detail.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events.</p>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2 text-left w-[80px]">Type</th>
                    <th className="px-3 py-2 text-left w-[140px]">Reason</th>
                    <th className="px-3 py-2 text-left">Message</th>
                    <th className="px-3 py-2 text-left w-[60px]">Count</th>
                    <th className="px-3 py-2 text-left w-[120px]">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.events.map((e, i) => (
                    <tr
                      key={i}
                      className="border-t border-border/40 align-top"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-mono uppercase",
                            e.type === "Warning"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          )}
                        >
                          {e.type === "Warning" ? (
                            <AlertTriangle className="size-3" />
                          ) : null}
                          {e.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{e.reason}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-pre-wrap break-words">
                        {e.message}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {e.count}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground tabular-nums">
                        {relTime(e.lastTimestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── YAML ────────────────────────────────────────────────────── */}
        <TabsContent value="yaml" className="pt-4">
          {detail === null ? (
            <Skeleton className="h-64" />
          ) : (
            <DetailBlock label="Pod manifest" content={detail.rawYaml} />
          )}
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground w-32 shrink-0">
        {label}
      </span>
      <span
        className={cn(
          "flex-1 min-w-0 truncate",
          mono && "font-mono",
          !mono && "text-foreground"
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
