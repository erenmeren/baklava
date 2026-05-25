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
import { Activity, Loader2, Skull } from "lucide-react";
import { RefreshButton } from "@/components/workspace/auto-refresh";

interface Session {
  sessionId: number;
  loginName: string | null;
  hostName: string | null;
  programName: string | null;
  databaseName: string | null;
  status: string | null;
  command: string | null;
  waitType: string | null;
  waitClass: string;
  blockingSessionId: number | null;
  cpuTime: number;
  reads: number;
  writes: number;
  openTransactions: number;
  elapsedMs: number | null;
  text: string | null;
  isUserProcess: boolean;
}

const WAIT_CLASS_TONE: Record<string, string> = {
  CPU: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Lock: "bg-rose-500/10 text-rose-600 border-rose-500/30",
  IO: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  Parallelism: "bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/30",
  Latch: "bg-violet-500/10 text-violet-500 border-violet-500/30",
  Memory: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  Network: "bg-indigo-500/10 text-indigo-500 border-indigo-500/30",
  Running: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Idle: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
  Other: "bg-zinc-500/5 text-muted-foreground border-border/40",
};

function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

export function ActivityClient({ connectionId }: { connectionId: string }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [userOnly, setUserOnly] = useState(true);
  const [waitFilter, setWaitFilter] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/activity`, {
        cache: "no-store",
        signal: ac.signal,
      });
      const data = await res.json();
      if (res.ok) setSessions(data.sessions as Session[]);
      else toast.error("Could not load activity", { description: data.error });
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        toast.error("Could not load activity");
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const histogram = useMemo(() => {
    const h: Record<string, number> = {};
    if (!sessions) return h;
    for (const s of sessions) {
      if (userOnly && !s.isUserProcess) continue;
      h[s.waitClass] = (h[s.waitClass] ?? 0) + 1;
    }
    return h;
  }, [sessions, userOnly]);

  const rows = useMemo(() => {
    if (!sessions) return [];
    const f = filter.trim().toLowerCase();
    return sessions.filter((s) => {
      if (userOnly && !s.isUserProcess) return false;
      if (waitFilter && s.waitClass !== waitFilter) return false;
      if (!f) return true;
      return (
        String(s.sessionId).includes(f) ||
        (s.loginName ?? "").toLowerCase().includes(f) ||
        (s.databaseName ?? "").toLowerCase().includes(f) ||
        (s.programName ?? "").toLowerCase().includes(f) ||
        (s.text ?? "").toLowerCase().includes(f)
      );
    });
  }, [sessions, filter, userOnly, waitFilter]);

  const kill = async () => {
    if (confirm == null) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/activity/${confirm}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Killed SPID ${confirm}`);
        await load();
      } else {
        toast.error(data.error || "Could not kill session");
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const blocked = sessions?.filter((s) => s.blockingSessionId != null).length ?? 0;

  return (
    <WorkspacePage
      title="Activity"
      description={
        sessions
          ? `${rows.length} session${rows.length === 1 ? "" : "s"}${blocked > 0 ? ` · ${blocked} blocked` : ""}`
          : "Loading sessions…"
      }
      actions={<RefreshButton onClick={load} loading={loading} />}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Activity className="size-3.5 text-muted-foreground" />
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={userOnly}
              onChange={(e) => setUserOnly(e.target.checked)}
              className="accent-brand"
            />
            User sessions only
          </label>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter spid / login / db / query…"
            className="h-8 max-w-md font-mono text-xs"
            spellCheck={false}
          />
        </div>

        {sessions ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mr-1">
              Wait class
            </span>
            {Object.entries(histogram)
              .sort((a, b) => b[1] - a[1])
              .map(([cls, n]) => {
                const active = waitFilter === cls;
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setWaitFilter(active ? null : cls)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-all",
                      WAIT_CLASS_TONE[cls] ?? WAIT_CLASS_TONE.Other,
                      active
                        ? "ring-2 ring-offset-1 ring-offset-background ring-current"
                        : "opacity-80 hover:opacity-100",
                    )}
                  >
                    {cls}
                    <span className="font-medium tabular-nums">{n}</span>
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

        {sessions && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No matching sessions.
          </p>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[70px]">SPID</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Wait</TableHead>
                  <TableHead className="text-right">CPU</TableHead>
                  <TableHead className="text-right">Elapsed</TableHead>
                  <TableHead className="min-w-[20ch]">Query</TableHead>
                  <TableHead className="w-[60px] text-right">Kill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow
                    key={s.sessionId}
                    className={cn(s.blockingSessionId != null && "bg-rose-500/5")}
                  >
                    <TableCell className="font-mono text-xs tabular-nums">
                      {s.sessionId}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.loginName ?? <span className="text-muted-foreground/50">—</span>}
                      {s.programName ? (
                        <div className="text-[10px] text-muted-foreground/60 truncate max-w-[20ch]">
                          {s.programName}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.databaseName ?? <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.status ?? "—"}
                      {s.blockingSessionId != null ? (
                        <div className="text-[10px] text-rose-500">
                          blocked by {s.blockingSessionId}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                          WAIT_CLASS_TONE[s.waitClass] ?? WAIT_CLASS_TONE.Other,
                        )}
                        title={s.waitType ?? undefined}
                      >
                        {s.waitClass}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-right text-muted-foreground">
                      {s.cpuTime}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-right text-muted-foreground">
                      {fmtDuration(s.elapsedMs)}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] max-w-[50ch]">
                      <details className="cursor-pointer">
                        <summary className="truncate list-none">
                          {s.text ?? <span className="text-muted-foreground/50">(idle)</span>}
                        </summary>
                        {s.text ? (
                          <pre className="mt-1 p-2 bg-muted/40 rounded text-[10px] whitespace-pre-wrap break-words">
                            {s.text}
                          </pre>
                        ) : null}
                      </details>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-muted-foreground hover:text-rose-500"
                        disabled={busy}
                        onClick={() => setConfirm(s.sessionId)}
                        title={`KILL ${s.sessionId}`}
                      >
                        <Skull className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(v) => { if (!v && !busy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kill session {confirm}?</AlertDialogTitle>
            <AlertDialogDescription>
              Runs <span className="font-mono">KILL {confirm}</span>. The session
              is terminated and any open transaction is rolled back — a large
              rollback can take a while.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={kill} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Kill
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}
