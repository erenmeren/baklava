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
import { ChevronDown, ChevronRight, Loader2, Lock, RefreshCcw, Skull } from "lucide-react";

interface BlockNode {
  sessionId: number;
  loginName: string | null;
  databaseName: string | null;
  status: string | null;
  waitType: string | null;
  command: string | null;
  text: string | null;
  blockingSessionId: number | null;
}

interface TreeNode {
  node: BlockNode;
  victims: TreeNode[];
}

function buildForest(nodes: BlockNode[]): TreeNode[] {
  const byId = new Map<number, BlockNode>();
  for (const n of nodes) byId.set(n.sessionId, n);
  const blockedSet = new Set(nodes.filter((n) => n.blockingSessionId != null).map((n) => n.sessionId));
  const blockerSet = new Set(
    nodes.map((n) => n.blockingSessionId).filter((v): v is number => v != null),
  );
  const childrenOf = (sid: number, seen: Set<number>): TreeNode[] =>
    nodes
      .filter((n) => n.blockingSessionId === sid && !seen.has(n.sessionId))
      .map((n) => {
        const next = new Set(seen).add(n.sessionId);
        return { node: n, victims: childrenOf(n.sessionId, next) };
      });
  // Roots: blockers that aren't themselves blocked (or absent from sessions).
  const roots = [...blockerSet].filter((sid) => !blockedSet.has(sid));
  return roots.sort((a, b) => a - b).map((sid) => ({
    node: byId.get(sid) ?? {
      sessionId: sid,
      loginName: null,
      databaseName: null,
      status: null,
      waitType: null,
      command: null,
      text: null,
      blockingSessionId: null,
    },
    victims: childrenOf(sid, new Set([sid])),
  }));
}

export function LocksClient({ connectionId }: { connectionId: string }) {
  const [nodes, setNodes] = useState<BlockNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/locks`, { cache: "no-store" });
      const d = await res.json();
      if (res.ok) setNodes(d.nodes as BlockNode[]);
      else toast.error("Could not load locks", { description: d.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const forest = useMemo(() => (nodes ? buildForest(nodes) : []), [nodes]);

  const kill = async () => {
    if (confirm == null) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/activity/${confirm}`, {
        method: "POST",
      });
      const d = await res.json();
      if (res.ok) {
        toast.success(`Killed SPID ${confirm}`);
        await load();
      } else toast.error(d.error || "Kill failed");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <WorkspacePage
      title="Locks"
      description={
        nodes == null
          ? "Loading…"
          : forest.length === 0
            ? "No blocking sessions"
            : `${forest.length} root blocker${forest.length === 1 ? "" : "s"}`
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
          Refresh
        </Button>
      }
    >
      {nodes && forest.length === 0 ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
          <Lock className="size-5 mx-auto text-emerald-600 mb-2" />
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            No sessions are blocked right now.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {forest.map((root) => (
            <BlockCard
              key={root.node.sessionId}
              tree={root}
              depth={0}
              expanded={expanded}
              setExpanded={setExpanded}
              onKill={(sid) => setConfirm(sid)}
            />
          ))}
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(v) => { if (!v && !busy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kill session {confirm}?</AlertDialogTitle>
            <AlertDialogDescription>
              Runs <span className="font-mono">KILL {confirm}</span>. All sessions
              blocked by it will unblock; its open transaction rolls back.
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

function BlockCard({
  tree,
  depth,
  expanded,
  setExpanded,
  onKill,
}: {
  tree: TreeNode;
  depth: number;
  expanded: Record<number, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  onKill: (sid: number) => void;
}) {
  const n = tree.node;
  const open = expanded[n.sessionId] ?? true;
  const hasKids = tree.victims.length > 0;
  return (
    <div className={cn("rounded-lg border bg-card/40", depth === 0 ? "border-rose-500/40" : "border-border/60")}>
      <header className={cn("flex items-start gap-3 px-3 py-2.5", depth === 0 && "bg-rose-500/5")}>
        {hasKids ? (
          <button
            type="button"
            onClick={() => setExpanded((s) => ({ ...s, [n.sessionId]: !open }))}
            className="mt-0.5 size-5 grid place-items-center rounded hover:bg-muted/60"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
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
              SPID {n.sessionId}
            </span>
            <span className="text-muted-foreground text-xs">
              {n.loginName ?? "—"}@{n.databaseName ?? "—"} · {n.status ?? "—"}
              {n.waitType ? ` · ${n.waitType}` : ""}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {depth === 0 ? `blocks ${tree.victims.length}` : `waiting`}
            </span>
          </div>
          {n.text ? (
            <pre className="font-mono text-[11px] text-muted-foreground mt-1.5 whitespace-pre-wrap break-words max-h-24 overflow-hidden">
              {n.text}
            </pre>
          ) : null}
        </div>
        <Button size="xs" variant="destructive" onClick={() => onKill(n.sessionId)}>
          <Skull className="size-3" />
          Kill
        </Button>
      </header>
      {open && hasKids ? (
        <div className="border-t border-border/60 px-3 py-2 space-y-2">
          {tree.victims.map((v) => (
            <div key={v.node.sessionId} className="pl-4 border-l-2 border-border/40 ml-2">
              <BlockCard tree={v} depth={depth + 1} expanded={expanded} setExpanded={setExpanded} onKill={onKill} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
