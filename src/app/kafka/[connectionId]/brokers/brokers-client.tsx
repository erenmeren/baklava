"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Loader2,
  RefreshCcw,
  Shuffle,
} from "lucide-react";

interface Broker {
  nodeId: number;
  host: string;
  port: number;
  rack?: string;
  isController: boolean;
  totalLogBytes?: number;
  partitionCount?: number;
  leaderCount?: number;
}

interface UnderReplicated {
  topic: string;
  partition: number;
  leader: number;
  replicas: number[];
  isr: number[];
  outOfSync: number[];
}

interface Reassignment {
  topic: string;
  partition: number;
  replicas: number[];
  addingReplicas: number[];
  removingReplicas: number[];
}

interface HealthSnapshot {
  underReplicated: UnderReplicated[];
  reassignments: Reassignment[];
}

interface Props {
  connectionId: string;
}

function fmtBytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function BrokersClient({ connectionId }: Props) {
  const [brokers, setBrokers] = useState<Broker[] | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/kafka/${connectionId}/brokers`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (res.ok) setBrokers(data.brokers as Broker[]);
    else toast.error("Could not load", { description: data.error });
  }, [connectionId]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await fetch(`/api/kafka/${connectionId}/health`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setHealth(data as HealthSnapshot);
      else toast.error("Could not load health", { description: data.error });
    } finally {
      setHealthLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
    void loadHealth();
  }, [load, loadHealth]);

  const maxLog =
    brokers?.reduce((m, b) => Math.max(m, b.totalLogBytes ?? 0), 0) ?? 0;

  return (
    <WorkspacePage
      title="Brokers"
      description={
        brokers
          ? `${brokers.length} broker${brokers.length === 1 ? "" : "s"} online`
          : undefined
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void load();
            void loadHealth();
          }}
        >
          <RefreshCcw className="size-3.5" />
          Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        {/* ── Health snapshot ────────────────────────────────────────── */}
        <section className="rounded-lg border border-border/60 bg-card/40">
          <header className="flex items-center justify-between border-b border-border/60 px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {health == null ? (
                healthLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null
              ) : health.underReplicated.length === 0 &&
                health.reassignments.length === 0 ? (
                <CheckCircle2 className="size-3.5 text-emerald-500" />
              ) : (
                <AlertTriangle className="size-3.5 text-amber-500" />
              )}
              Cluster health
            </div>
            {health != null ? (
              <div className="text-[10px] font-mono text-muted-foreground">
                {health.underReplicated.length} URP ·{" "}
                {health.reassignments.length} ongoing reassignment
                {health.reassignments.length === 1 ? "" : "s"}
              </div>
            ) : null}
          </header>

          <div className="px-4 py-3 space-y-3">
            {health == null ? (
              <Skeleton className="h-12 w-full" />
            ) : health.underReplicated.length === 0 &&
              health.reassignments.length === 0 ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                Every partition is fully in-sync and no reassignment is in
                progress.
              </p>
            ) : (
              <>
                {health.underReplicated.length > 0 ? (
                  <details open>
                    <summary className="cursor-pointer text-xs uppercase tracking-wider font-mono text-amber-700 dark:text-amber-400 mb-2">
                      Under-replicated partitions ({health.underReplicated.length})
                    </summary>
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Topic</TableHead>
                            <TableHead>P</TableHead>
                            <TableHead>Leader</TableHead>
                            <TableHead>Replicas</TableHead>
                            <TableHead>ISR</TableHead>
                            <TableHead>Out of sync</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {health.underReplicated.map((u) => (
                            <TableRow
                              key={`${u.topic}-${u.partition}`}
                              className="font-mono text-xs"
                            >
                              <TableCell>{u.topic}</TableCell>
                              <TableCell>{u.partition}</TableCell>
                              <TableCell>{u.leader}</TableCell>
                              <TableCell>{u.replicas.join(", ")}</TableCell>
                              <TableCell>{u.isr.join(", ")}</TableCell>
                              <TableCell className="text-rose-500">
                                {u.outOfSync.join(", ")}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                ) : null}

                {health.reassignments.length > 0 ? (
                  <details open>
                    <summary className="cursor-pointer text-xs uppercase tracking-wider font-mono text-sky-700 dark:text-sky-400 mb-2 inline-flex items-center gap-1.5">
                      <Shuffle className="size-3" />
                      In-progress reassignments ({health.reassignments.length})
                    </summary>
                    <div className="rounded-md border border-sky-500/30 bg-sky-500/5 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Topic</TableHead>
                            <TableHead>P</TableHead>
                            <TableHead>Replicas</TableHead>
                            <TableHead>Adding</TableHead>
                            <TableHead>Removing</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {health.reassignments.map((r) => (
                            <TableRow
                              key={`${r.topic}-${r.partition}`}
                              className="font-mono text-xs"
                            >
                              <TableCell>{r.topic}</TableCell>
                              <TableCell>{r.partition}</TableCell>
                              <TableCell>{r.replicas.join(", ")}</TableCell>
                              <TableCell className="text-emerald-600">
                                {r.addingReplicas.join(", ") || "—"}
                              </TableCell>
                              <TableCell className="text-rose-500">
                                {r.removingReplicas.join(", ") || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* ── Broker table ───────────────────────────────────────────── */}
        {brokers === null ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Rack</TableHead>
                  <TableHead className="text-right">Partitions</TableHead>
                  <TableHead className="text-right">Leaders</TableHead>
                  <TableHead className="text-right">Disk used</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brokers.map((b) => {
                  const diskPct =
                    maxLog > 0 && b.totalLogBytes
                      ? (b.totalLogBytes / maxLog) * 100
                      : 0;
                  return (
                    <TableRow key={b.nodeId}>
                      <TableCell className="font-mono text-xs">
                        {b.nodeId}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {b.host}:{b.port}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {b.rack ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-right">
                        {b.partitionCount ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-right">
                        {b.leaderCount ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {fmtBytes(b.totalLogBytes)}
                          </span>
                          <div className="w-16 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full transition-all",
                                diskPct > 80
                                  ? "bg-rose-500"
                                  : diskPct > 50
                                    ? "bg-amber-500"
                                    : "bg-emerald-500",
                              )}
                              style={{ width: `${Math.min(100, diskPct)}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-1">
                          {b.isController ? <Badge>controller</Badge> : null}
                          <HardDrive className="size-3 text-muted-foreground/40" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}
