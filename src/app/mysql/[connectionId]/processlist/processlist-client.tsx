"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  AutoRefresh,
  DEFAULT_REFRESH_INTERVALS,
} from "@/components/workspace/auto-refresh";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Activity, Loader2, Skull } from "lucide-react";

interface ProcessRow {
  id: number;
  user: string;
  host: string;
  db: string | null;
  command: string;
  time: number;
  state: string;
  info: string | null;
}

interface ProcessListResponse {
  processes: ProcessRow[];
}

/**
 * Tones for the MySQL Command column. `Sleep` is the idle equivalent;
 * `Query` is the hot path. Everything else gets a neutral fallback.
 */
const COMMAND_TONES: Record<string, string> = {
  Query: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Execute: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Sleep: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
  Connect: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  Binlog: "bg-indigo-500/10 text-indigo-500 border-indigo-500/30",
  "Binlog Dump": "bg-indigo-500/10 text-indigo-500 border-indigo-500/30",
  Killed: "bg-rose-500/10 text-rose-600 border-rose-500/30",
};

function isRunning(r: ProcessRow): boolean {
  return r.command !== "Sleep";
}

function formatDuration(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (m < 60) return `${m}m${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

/** Tailwind text tone for the Time column — louder the longer it runs. */
function timeTone(r: ProcessRow): string {
  if (!isRunning(r)) return "text-muted-foreground";
  if (r.time >= 60) return "text-rose-600 font-medium";
  if (r.time >= 10) return "text-amber-600";
  return "text-foreground";
}

export function ProcessListClient({
  connectionId,
}: {
  connectionId: string;
  connectionName: string;
}) {
  const base = `/api/mysql/${connectionId}/processlist`;
  const [processes, setProcesses] = useState<ProcessRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [commandFilter, setCommandFilter] = useState<"all" | "running" | "sleep">(
    "all"
  );
  const [confirm, setConfirm] = useState<ProcessRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setProcesses((data as ProcessListResponse).processes);
        setError(null);
      } else {
        setError(data.error || "Could not load process list");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load process list");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!processes) return [] as ProcessRow[];
    const f = filter.trim().toLowerCase();
    return processes.filter((r) => {
      if (commandFilter === "running" && !isRunning(r)) return false;
      if (commandFilter === "sleep" && r.command !== "Sleep") return false;
      if (!f) return true;
      return (
        String(r.id).includes(f) ||
        r.user.toLowerCase().includes(f) ||
        r.host.toLowerCase().includes(f) ||
        (r.db ?? "").toLowerCase().includes(f) ||
        r.command.toLowerCase().includes(f) ||
        (r.state ?? "").toLowerCase().includes(f) ||
        (r.info ?? "").toLowerCase().includes(f)
      );
    });
  }, [processes, filter, commandFilter]);

  const counts = useMemo(() => {
    const out = { total: 0, running: 0, longest: 0 };
    if (!processes) return out;
    for (const r of processes) {
      out.total++;
      if (isRunning(r)) {
        out.running++;
        if (r.time > out.longest) out.longest = r.time;
      }
    }
    return out;
  }, [processes]);

  const submitKill = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/${confirm.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Killed connection ${confirm.id}`, {
          description: data.ok
            ? undefined
            : "Server returned false — connection may have already exited",
        });
        await load();
      } else {
        toast.error(data.error || "Kill failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kill failed");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <WorkspacePage
      title="Process list"
      description={
        processes
          ? `${counts.total} connection${counts.total === 1 ? "" : "s"} · ${counts.running} running${counts.longest ? ` · longest ${formatDuration(counts.longest)}` : ""}`
          : "Loading connections…"
      }
      actions={
        <AutoRefresh
          intervalMs={3_000}
          intervals={DEFAULT_REFRESH_INTERVALS}
          defaultPlaying={false}
          onTick={load}
          loading={loading}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Activity className="size-3.5 text-muted-foreground" />
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(
              [
                ["all", "All"],
                ["running", "Running"],
                ["sleep", "Sleep"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCommandFilter(k)}
                className={cn(
                  "px-2.5 py-1 text-xs font-mono rounded-sm",
                  commandFilter === k
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
            placeholder="Filter id / user / host / db / sql…"
            className="h-8 max-w-md font-mono text-xs"
            spellCheck={false}
          />
        </div>

        {error ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-mono text-rose-600">
            {error}
          </div>
        ) : null}

        {!processes && !error ? (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <div className="divide-y divide-border/40">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="h-3 w-10 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ) : processes && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No matching connections.
          </p>
        ) : processes ? (
          <div className="rounded-lg border border-border/60 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>DB</TableHead>
                  <TableHead>Command</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="min-w-[20ch]">Info</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const tone =
                    COMMAND_TONES[r.command] ??
                    "bg-zinc-500/5 text-zinc-500 border-zinc-500/20";
                  const longRunning = isRunning(r) && r.time >= 60;
                  return (
                    <TableRow
                      key={r.id}
                      className={cn(longRunning && "bg-rose-500/5")}
                    >
                      <TableCell className="font-mono text-xs tabular-nums">
                        {r.id}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.user || (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.host || (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.db ?? (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                            tone
                          )}
                        >
                          {r.command}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs tabular-nums",
                          timeTone(r)
                        )}
                      >
                        {formatDuration(r.time)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {r.state || (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] max-w-[60ch]">
                        <details className="cursor-pointer">
                          <summary className="truncate list-none">
                            {r.info ?? (
                              <span className="text-muted-foreground/50">
                                (no query)
                              </span>
                            )}
                          </summary>
                          {r.info ? (
                            <pre className="mt-1 p-2 bg-muted/40 rounded text-[10px] whitespace-pre-wrap break-words">
                              {r.info}
                            </pre>
                          ) : null}
                        </details>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => setConfirm(r)}
                          title="KILL connection"
                        >
                          <Skull className="size-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
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
            <AlertDialogTitle>Kill connection?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? (
                <>
                  Runs{" "}
                  <span className="font-mono">KILL {confirm.id}</span>. The
                  connection is terminated and its current query aborted; the
                  client will see a connection error.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={submitKill} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Kill
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}
