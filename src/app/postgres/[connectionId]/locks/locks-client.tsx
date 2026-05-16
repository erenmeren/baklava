"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { Loader2, RefreshCcw, Skull } from "lucide-react";

interface LockEdge {
  blockedPid: number;
  blockedQuery: string | null;
  blockedUser: string | null;
  blockedDatabase: string | null;
  blockedState: string | null;
  blockingPid: number;
  blockingQuery: string | null;
  blockingUser: string | null;
  blockingDatabase: string | null;
  blockingState: string | null;
  relation: string | null;
  lockMode: string | null;
  waitSeconds: number | null;
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

export function LocksClient({ connectionId }: { connectionId: string }) {
  const [edges, setEdges] = useState<LockEdge[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/postgres/${connectionId}/locks`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setEdges(data.edges as LockEdge[]);
      else toast.error("Could not load locks", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const terminate = async () => {
    if (confirm == null) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/postgres/${connectionId}/activity/${confirm}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "terminate" }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Terminated PID ${confirm}`);
        await load();
      } else {
        toast.error(data.error || "Could not terminate");
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <WorkspacePage
      title="Locks"
      description={
        edges
          ? edges.length === 0
            ? "No blocking sessions"
            : `${edges.length} blocking edge${edges.length === 1 ? "" : "s"}`
          : "Loading locks…"
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="size-3.5" />
          )}
          Refresh
        </Button>
      }
    >
      {edges && edges.length === 0 ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <p className="text-sm font-mono text-emerald-700 dark:text-emerald-400">
            No sessions blocked.
          </p>
        </div>
      ) : edges ? (
        <div className="rounded-lg border border-border/60 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Blocked PID</TableHead>
                <TableHead>Blocked by</TableHead>
                <TableHead>Wait</TableHead>
                <TableHead>Relation</TableHead>
                <TableHead>Lock mode</TableHead>
                <TableHead className="min-w-[20ch]">Waiting query</TableHead>
                <TableHead className="min-w-[20ch]">Blocking query</TableHead>
                <TableHead className="w-[100px] text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {edges.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs tabular-nums">
                    <div>{e.blockedPid}</div>
                    <div className="text-muted-foreground text-[10px]">
                      {e.blockedUser ?? "—"}@{e.blockedDatabase ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    <div className="text-rose-600">{e.blockingPid}</div>
                    <div className="text-muted-foreground text-[10px]">
                      {e.blockingUser ?? "—"}@{e.blockingDatabase ?? "—"} ·{" "}
                      {e.blockingState ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-amber-600">
                    {formatDuration(e.waitSeconds)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.relation ?? <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.lockMode ?? <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] max-w-[40ch]">
                    <span className="block truncate" title={e.blockedQuery ?? undefined}>
                      {e.blockedQuery ?? (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] max-w-[40ch]">
                    <span className="block truncate" title={e.blockingQuery ?? undefined}>
                      {e.blockingQuery ?? (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="xs"
                      variant="destructive"
                      onClick={() => setConfirm(e.blockingPid)}
                      title={`Terminate blocker (${e.blockingPid})`}
                    >
                      <Skull className="size-3" />
                      Kill blocker
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v && !busy) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate blocking session?</AlertDialogTitle>
            <AlertDialogDescription>
              Runs{" "}
              <span className="font-mono">
                pg_terminate_backend({confirm ?? "?"})
              </span>
              . The blocking backend is killed; all sessions waiting on it will
              unblock.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={terminate}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Terminate
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}
