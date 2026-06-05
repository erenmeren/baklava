"use client";
import { Button } from "@/components/ui/button";

export interface PendingApproval {
  toolCallId: string;
  tool: string;
  category: "read" | "write" | "destructive";
  args: unknown;
  connection?: { id: string; name: string };
  /** Session the approval belongs to — used to route the decision correctly. */
  sessionId?: string;
}

export function ApprovalCard({
  pending,
  onDecision,
}: {
  pending: PendingApproval;
  onDecision: (toolCallId: string, decision: "approve" | "reject") => void;
}) {
  const destructive = pending.category === "destructive";
  return (
    <div
      className={`rounded-lg border p-3 my-2 ${
        destructive ? "border-destructive/50 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"
      }`}
    >
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
        {destructive ? "Destructive action" : "Action"} needs approval{pending.connection ? <> on <b>{pending.connection.name}</b></> : null}
      </div>
      <div className="font-mono text-sm font-medium">{pending.tool}</div>
      <pre className="mt-1 text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto">
        {JSON.stringify(pending.args, null, 2)}
      </pre>
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={() => onDecision(pending.toolCallId, "approve")}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecision(pending.toolCallId, "reject")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
