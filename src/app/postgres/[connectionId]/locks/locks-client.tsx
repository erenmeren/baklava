"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Skull,
  Zap,
} from "lucide-react";
import { RefreshButton } from "@/components/workspace/auto-refresh";

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

interface SessionInfo {
  pid: number;
  user: string | null;
  database: string | null;
  state: string | null;
  query: string | null;
  waitSeconds: number | null;
}

interface BlockingNode {
  pid: number;
  info: SessionInfo;
  /** edges originating from this blocker (its direct victims). */
  victims: Array<{
    edge: LockEdge;
    node: BlockingNode | null; // children if this victim is itself a blocker
  }>;
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

/** Build a forest of blocking trees from a flat edge list. */
function buildForest(edges: LockEdge[]): BlockingNode[] {
  // PIDs that appear ONLY as victims (blocked, never blocking) are leaves.
  // PIDs that appear as blockers AND never as a victim are roots.
  // PIDs that appear as both are intermediate nodes.
  const blockingSet = new Set(edges.map((e) => e.blockingPid));
  const blockedSet = new Set(edges.map((e) => e.blockedPid));

  // Index session info per pid (taking either side of an edge that has it).
  const sessionByPid = new Map<number, SessionInfo>();
  for (const e of edges) {
    if (!sessionByPid.has(e.blockingPid)) {
      sessionByPid.set(e.blockingPid, {
        pid: e.blockingPid,
        user: e.blockingUser,
        database: e.blockingDatabase,
        state: e.blockingState,
        query: e.blockingQuery,
        waitSeconds: null,
      });
    }
    if (!sessionByPid.has(e.blockedPid)) {
      sessionByPid.set(e.blockedPid, {
        pid: e.blockedPid,
        user: e.blockedUser,
        database: e.blockedDatabase,
        state: e.blockedState,
        query: e.blockedQuery,
        waitSeconds: e.waitSeconds,
      });
    }
  }

  const edgesByBlocker = new Map<number, LockEdge[]>();
  for (const e of edges) {
    const arr = edgesByBlocker.get(e.blockingPid) ?? [];
    arr.push(e);
    edgesByBlocker.set(e.blockingPid, arr);
  }

  // Memoize to handle a pid appearing as a victim multiple times (multiple
  // blockers); each subtree under one path is built once. Cycle guard via
  // visited set per branch.
  function build(pid: number, ancestors: Set<number>): BlockingNode {
    const info =
      sessionByPid.get(pid) ?? {
        pid,
        user: null,
        database: null,
        state: null,
        query: null,
        waitSeconds: null,
      };
    const childEdges = edgesByBlocker.get(pid) ?? [];
    const next = new Set(ancestors);
    next.add(pid);
    return {
      pid,
      info,
      victims: childEdges.map((edge) => ({
        edge,
        node:
          blockingSet.has(edge.blockedPid) && !ancestors.has(edge.blockedPid)
            ? build(edge.blockedPid, next)
            : null,
      })),
    };
  }

  const roots = [...blockingSet].filter((pid) => !blockedSet.has(pid));
  return roots.sort((a, b) => a - b).map((pid) => build(pid, new Set()));
}

export function LocksClient({ connectionId }: { connectionId: string }) {
  const [edges, setEdges] = useState<LockEdge[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<{
    pid: number;
    kind: "cancel" | "terminate";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

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

  // Auto-expand all roots on first data arrival so the user sees the chain.
  useEffect(() => {
    if (edges && Object.keys(expanded).length === 0) {
      const next: Record<number, boolean> = {};
      const blockingSet = new Set(edges.map((e) => e.blockingPid));
      const blockedSet = new Set(edges.map((e) => e.blockedPid));
      for (const pid of blockingSet) if (!blockedSet.has(pid)) next[pid] = true;
      if (Object.keys(next).length > 0) setExpanded(next);
    }
  }, [edges, expanded]);

  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/postgres/${connectionId}/activity/${confirm.pid}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: confirm.kind }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `${confirm.kind === "cancel" ? "Canceled" : "Terminated"} PID ${confirm.pid}`,
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

  const forest = useMemo(() => (edges ? buildForest(edges) : []), [edges]);

  const totalVictims = useMemo(() => {
    if (!edges) return 0;
    return new Set(edges.map((e) => e.blockedPid)).size;
  }, [edges]);

  return (
    <WorkspacePage
      title="Locks"
      description={
        edges == null
          ? "Loading locks…"
          : edges.length === 0
            ? "No blocking sessions"
            : `${forest.length} root blocker${forest.length === 1 ? "" : "s"} · ${totalVictims} session${totalVictims === 1 ? "" : "s"} waiting`
      }
      actions={<RefreshButton onClick={load} loading={loading} />}
    >
      {edges && edges.length === 0 ? (
        <div className="mx-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
          <Lock className="size-5 mx-auto text-emerald-600 mb-2" />
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            No sessions are blocked right now.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Postgres uses lock contention sparingly — this is the healthy state.
          </p>
        </div>
      ) : forest.length > 0 ? (
        <div className="px-6 pb-8 space-y-3">
          {forest.map((root) => (
            <BlockingTreeCard
              key={root.pid}
              node={root}
              depth={0}
              expanded={expanded}
              setExpanded={setExpanded}
              onCancel={(pid) => setConfirm({ pid, kind: "cancel" })}
              onTerminate={(pid) => setConfirm({ pid, kind: "terminate" })}
            />
          ))}
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
            <AlertDialogTitle>
              {confirm?.kind === "cancel"
                ? "Cancel query?"
                : "Terminate backend?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Runs{" "}
              <span className="font-mono">
                pg_{confirm?.kind === "cancel" ? "cancel" : "terminate"}_backend(
                {confirm?.pid ?? "?"})
              </span>
              .{" "}
              {confirm?.kind === "cancel"
                ? "Sends SIGINT to the backend — the current statement aborts, but the connection stays."
                : "Sends SIGTERM — the connection drops. All sessions waiting on this PID will unblock."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant={confirm?.kind === "terminate" ? "destructive" : "default"}
              onClick={act}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {confirm?.kind === "cancel" ? "Cancel query" : "Terminate"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

interface TreeCardProps {
  node: BlockingNode;
  depth: number;
  expanded: Record<number, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  onCancel: (pid: number) => void;
  onTerminate: (pid: number) => void;
}

function BlockingTreeCard({
  node,
  depth,
  expanded,
  setExpanded,
  onCancel,
  onTerminate,
}: TreeCardProps) {
  const isExpanded = expanded[node.pid] ?? depth === 0;
  const hasChildren = node.victims.length > 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card/40",
        depth === 0 ? "border-rose-500/40" : "border-border/60",
      )}
    >
      <header
        className={cn(
          "flex items-start gap-3 px-3 py-2.5",
          depth === 0 && "bg-rose-500/5",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() =>
              setExpanded((s) => ({ ...s, [node.pid]: !isExpanded }))
            }
            className="mt-0.5 size-5 grid place-items-center rounded hover:bg-muted/60"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="size-5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-mono">
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-xs font-medium",
                depth === 0
                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
              )}
            >
              PID {node.pid}
            </span>
            <span className="text-muted-foreground text-xs">
              {node.info.user ?? "—"}@{node.info.database ?? "—"} ·{" "}
              {node.info.state ?? "—"}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {depth === 0
                ? `blocks ${node.victims.length}`
                : `→ blocks ${node.victims.length}`}
            </span>
          </div>
          {node.info.query ? (
            <pre className="font-mono text-[11px] text-muted-foreground mt-1.5 whitespace-pre-wrap break-words max-h-24 overflow-hidden">
              {node.info.query}
            </pre>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            onClick={() => onCancel(node.pid)}
            title={`Cancel current query on PID ${node.pid}`}
          >
            <Zap className="size-3" />
            Cancel
          </Button>
          <Button
            size="xs"
            variant="destructive"
            onClick={() => onTerminate(node.pid)}
            title={`Terminate PID ${node.pid}`}
          >
            <Skull className="size-3" />
            Kill
          </Button>
        </div>
      </header>

      {isExpanded && hasChildren ? (
        <div className="border-t border-border/60 px-3 py-2 space-y-2">
          {node.victims.map((v, i) => (
            <VictimRow
              key={`${v.edge.blockedPid}-${i}`}
              edge={v.edge}
              child={v.node}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
              onCancel={onCancel}
              onTerminate={onTerminate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VictimRow({
  edge,
  child,
  depth,
  expanded,
  setExpanded,
  onCancel,
  onTerminate,
}: {
  edge: LockEdge;
  child: BlockingNode | null;
  depth: number;
  expanded: Record<number, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  onCancel: (pid: number) => void;
  onTerminate: (pid: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-3 text-xs rounded-md border border-border/40 bg-background/50 px-2.5 py-2">
        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-mono">
          PID {edge.blockedPid}
        </span>
        <div className="flex-1 min-w-0 font-mono">
          <div className="text-muted-foreground text-[11px]">
            {edge.blockedUser ?? "—"}@{edge.blockedDatabase ?? "—"} · waiting{" "}
            <span className="text-amber-600">
              {formatDuration(edge.waitSeconds)}
            </span>{" "}
            {edge.lockMode ? (
              <>
                · <span className="text-foreground/80">{edge.lockMode}</span>
              </>
            ) : null}
            {edge.relation ? (
              <>
                {" "}
                on <span className="text-foreground/80">{edge.relation}</span>
              </>
            ) : null}
          </div>
          {edge.blockedQuery ? (
            <pre className="text-[11px] mt-1 whitespace-pre-wrap break-words max-h-16 overflow-hidden">
              {edge.blockedQuery}
            </pre>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onCancel(edge.blockedPid)}
            title={`Cancel ${edge.blockedPid}`}
          >
            <Zap className="size-3" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onTerminate(edge.blockedPid)}
            title={`Terminate ${edge.blockedPid}`}
          >
            <Skull className="size-3" />
          </Button>
        </div>
      </div>
      {child ? (
        <div className="pl-4 border-l-2 border-border/40 ml-2">
          <BlockingTreeCard
            node={child}
            depth={depth}
            expanded={expanded}
            setExpanded={setExpanded}
            onCancel={onCancel}
            onTerminate={onTerminate}
          />
        </div>
      ) : null}
    </div>
  );
}
