"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
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
  Activity,
  Ban,
  Loader2,
  RefreshCcw,
  Skull,
} from "lucide-react";

interface ActivityRow {
  pid: number;
  database: string | null;
  user: string | null;
  applicationName: string | null;
  clientAddr: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  backendStart: string | null;
  xactStart: string | null;
  queryStart: string | null;
  stateChange: string | null;
  backendType: string | null;
  query: string | null;
  queryAgeSeconds: number | null;
}

interface ActivitySnapshot {
  serverPid: number;
  rows: ActivityRow[];
}

type RefreshInterval = "off" | "2" | "5" | "15";

const STATE_TONES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  idle: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
  "idle in transaction": "bg-amber-500/10 text-amber-600 border-amber-500/30",
  "idle in transaction (aborted)":
    "bg-rose-500/10 text-rose-600 border-rose-500/30",
  fastpath: "bg-sky-500/10 text-sky-600 border-sky-500/30",
};

/**
 * Wait classes from pg_stat_activity.wait_event_type. Ordered by how often
 * they matter when triaging a slow system. "CPU" is synthetic — assigned to
 * `active` sessions that report no wait_event.
 */
const WAIT_CLASSES = [
  "CPU",
  "Lock",
  "IO",
  "IPC",
  "LWLock",
  "BufferPin",
  "Timeout",
  "Client",
  "Extension",
  "Activity",
] as const;
type WaitClass = (typeof WAIT_CLASSES)[number];

const WAIT_CLASS_TONES: Record<WaitClass, string> = {
  CPU: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Lock: "bg-rose-500/10 text-rose-600 border-rose-500/30",
  IO: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  IPC: "bg-indigo-500/10 text-indigo-500 border-indigo-500/30",
  LWLock: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/30",
  BufferPin: "bg-violet-500/10 text-violet-500 border-violet-500/30",
  Timeout: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  Client: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
  Extension: "bg-teal-500/10 text-teal-500 border-teal-500/30",
  Activity: "bg-zinc-500/5 text-muted-foreground border-border/40",
};

function classifyRow(r: ActivityRow): WaitClass | null {
  if (r.waitEventType && WAIT_CLASSES.includes(r.waitEventType as WaitClass)) {
    return r.waitEventType as WaitClass;
  }
  if (r.state === "active" && !r.waitEventType) return "CPU";
  return null;
}

function formatDuration(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "—";
  if (s < 1) return `${Math.max(0, Math.round(s * 1000))}ms`;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (m < 60) return `${m}m${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export function ActivityClient({ connectionId }: { connectionId: string }) {
  const base = `/api/postgres/${connectionId}/activity`;
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | "active" | "idle" | "idle-in-tx">("all");
  const [refresh, setRefresh] = useState<RefreshInterval>("off");
  const [waitFilter, setWaitFilter] = useState<WaitClass | null>(null);
  const [confirm, setConfirm] = useState<{ pid: number; action: "cancel" | "terminate" } | null>(null);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setSnapshot(data as ActivitySnapshot);
      else toast.error("Could not load activity", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (refresh !== "off") {
      const ms = Number(refresh) * 1000;
      timerRef.current = setInterval(() => load(), ms);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh, load]);

  const rows = useMemo(() => {
    if (!snapshot) return [] as ActivityRow[];
    const f = filter.trim().toLowerCase();
    return snapshot.rows.filter((r) => {
      if (stateFilter === "active" && r.state !== "active") return false;
      if (stateFilter === "idle" && r.state !== "idle") return false;
      if (
        stateFilter === "idle-in-tx" &&
        !(r.state ?? "").startsWith("idle in transaction")
      )
        return false;
      if (waitFilter && classifyRow(r) !== waitFilter) return false;
      if (!f) return true;
      return (
        String(r.pid).includes(f) ||
        (r.user ?? "").toLowerCase().includes(f) ||
        (r.database ?? "").toLowerCase().includes(f) ||
        (r.applicationName ?? "").toLowerCase().includes(f) ||
        (r.clientAddr ?? "").toLowerCase().includes(f) ||
        (r.query ?? "").toLowerCase().includes(f)
      );
    });
  }, [snapshot, filter, stateFilter, waitFilter]);

  // Histogram of wait classes (informational only — also the source of truth
  // for the wait-class filter strip below).
  const waitHistogram = useMemo(() => {
    const h: Record<WaitClass, number> = Object.fromEntries(
      WAIT_CLASSES.map((c) => [c, 0]),
    ) as Record<WaitClass, number>;
    if (!snapshot) return h;
    for (const r of snapshot.rows) {
      const c = classifyRow(r);
      if (c) h[c] += 1;
    }
    return h;
  }, [snapshot]);

  const counts = useMemo(() => {
    const out = { active: 0, idle: 0, idleInTx: 0, total: 0 };
    if (!snapshot) return out;
    for (const r of snapshot.rows) {
      out.total++;
      if (r.state === "active") out.active++;
      else if (r.state === "idle") out.idle++;
      else if ((r.state ?? "").startsWith("idle in transaction")) out.idleInTx++;
    }
    return out;
  }, [snapshot]);

  const submitAction = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/${confirm.pid}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: confirm.action }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          confirm.action === "cancel"
            ? `Cancelled PID ${confirm.pid}`
            : `Terminated PID ${confirm.pid}`,
          {
            description: data.ok
              ? undefined
              : "Server returned false — backend may have already exited",
          }
        );
        await load();
      } else {
        toast.error(data.error || "Action failed");
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <WorkspacePage
      title="Activity"
      description={
        snapshot
          ? `${counts.total} session${counts.total === 1 ? "" : "s"} · ${counts.active} active · ${counts.idle} idle${counts.idleInTx ? ` · ${counts.idleInTx} idle-in-tx` : ""}`
          : "Loading sessions…"
      }
      actions={
        <>
          <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            Refresh
            <select
              value={refresh}
              onChange={(e) => setRefresh(e.target.value as RefreshInterval)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
            >
              <option value="off">off</option>
              <option value="2">2s</option>
              <option value="5">5s</option>
              <option value="15">15s</option>
            </select>
          </label>
          {refresh !== "off" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-emerald-600">
              <span className="size-1.5 rounded-full bg-emerald-500 status-pulse" />
              live
            </span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
            Refresh now
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Activity className="size-3.5 text-muted-foreground" />
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["idle", "Idle"],
                ["idle-in-tx", "Idle in tx"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStateFilter(k)}
                className={cn(
                  "px-2.5 py-1 text-xs font-mono rounded-sm",
                  stateFilter === k
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter pid / user / db / query…"
            className="h-8 max-w-md font-mono text-xs"
            spellCheck={false}
          />
        </div>

        {/* Wait-class strip */}
        {snapshot ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mr-1">
              Wait class
            </span>
            {WAIT_CLASSES.filter((c) => waitHistogram[c] > 0).map((c) => {
              const active = waitFilter === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setWaitFilter(active ? null : c)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-all",
                    WAIT_CLASS_TONES[c],
                    active
                      ? "ring-2 ring-offset-1 ring-offset-background ring-current"
                      : "opacity-80 hover:opacity-100",
                  )}
                >
                  <span>{c}</span>
                  <span className="font-medium tabular-nums">
                    {waitHistogram[c]}
                  </span>
                </button>
              );
            })}
            {waitFilter ? (
              <button
                type="button"
                onClick={() => setWaitFilter(null)}
                className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground ml-1"
              >
                clear
              </button>
            ) : null}
          </div>
        ) : null}

        {snapshot && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No matching sessions.
          </p>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">PID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Wait</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead className="min-w-[20ch]">Query</TableHead>
                  <TableHead className="w-[120px] text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const tone =
                    STATE_TONES[r.state ?? ""] ??
                    "bg-zinc-500/5 text-zinc-500 border-zinc-500/20";
                  const idleInTx = (r.state ?? "").startsWith(
                    "idle in transaction"
                  );
                  return (
                    <TableRow
                      key={r.pid}
                      className={cn(idleInTx && "bg-amber-500/5")}
                    >
                      <TableCell className="font-mono text-xs tabular-nums">
                        {r.pid}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.user ?? <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.database ?? <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.applicationName || (
                          <span className="text-muted-foreground/50">
                            {r.backendType ?? "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.state ? (
                          <span
                            className={cn(
                              "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                              tone
                            )}
                          >
                            {r.state}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50 text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {(() => {
                          const wc = classifyRow(r);
                          if (!wc)
                            return (
                              <span className="text-muted-foreground/50">—</span>
                            );
                          return (
                            <div className="inline-flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                                  WAIT_CLASS_TONES[wc],
                                )}
                              >
                                {wc}
                              </span>
                              {r.waitEvent ? (
                                <span className="text-muted-foreground truncate">
                                  {r.waitEvent}
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatDuration(r.queryAgeSeconds)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] max-w-[60ch]">
                        <details className="cursor-pointer">
                          <summary className="truncate list-none">
                            {r.query ?? (
                              <span className="text-muted-foreground/50">
                                (no query)
                              </span>
                            )}
                          </summary>
                          {r.query ? (
                            <pre className="mt-1 p-2 bg-muted/40 rounded text-[10px] whitespace-pre-wrap break-words">
                              {r.query}
                            </pre>
                          ) : null}
                        </details>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={
                              busy || r.state === "idle" || r.state == null
                            }
                            onClick={() =>
                              setConfirm({ pid: r.pid, action: "cancel" })
                            }
                            title="pg_cancel_backend"
                          >
                            <Ban className="size-3" />
                          </Button>
                          <Button
                            size="xs"
                            variant="destructive"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({ pid: r.pid, action: "terminate" })
                            }
                            title="pg_terminate_backend"
                          >
                            <Skull className="size-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {snapshot && counts.idleInTx > 0 ? (
          <p className="text-xs text-amber-600 font-mono">
            {counts.idleInTx} session{counts.idleInTx === 1 ? "" : "s"} idle in
            transaction — these hold locks and bloat tables. Terminate or commit.
          </p>
        ) : null}
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v && !busy) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "cancel"
                ? "Cancel query?"
                : "Terminate session?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "cancel" ? (
                <>
                  Runs{" "}
                  <span className="font-mono">
                    pg_cancel_backend({confirm.pid})
                  </span>
                  . The current query gets a cancel signal; the session stays
                  alive.
                </>
              ) : confirm ? (
                <>
                  Runs{" "}
                  <span className="font-mono">
                    pg_terminate_backend({confirm.pid})
                  </span>
                  . The whole backend is killed; the client will see a connection
                  error.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant={
                confirm?.action === "terminate" ? "destructive" : "default"
              }
              onClick={submitAction}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {confirm?.action === "cancel" ? "Cancel query" : "Terminate"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}
