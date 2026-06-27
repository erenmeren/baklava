"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface PendingApproval {
  toolCallId: string;
  tool: string;
  category: "read" | "write" | "destructive";
  args: unknown;
  connection?: { id: string; name: string };
  /** Session the approval belongs to — used to route the decision correctly. */
  sessionId?: string;
  risk?: { level: "low" | "medium" | "high"; reasons: string[] };
}

export function ApprovalCard({
  pending,
  onDecision,
}: {
  pending: PendingApproval;
  onDecision: (toolCallId: string, decision: "approve" | "reject") => void;
}) {
  const destructive = pending.category === "destructive";
  const high = pending.risk?.level === "high";
  // High-risk requires typing the connection name (or tool name) to confirm.
  const confirmTarget = pending.connection?.name ?? pending.tool;
  const [typed, setTyped] = useState("");
  const approveEnabled = !high || typed.trim() === confirmTarget;

  return (
    <div
      className={`rounded-lg border p-3 my-2 ${
        destructive ? "border-destructive/50 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"
      }`}
    >
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
        {destructive ? "Destructive action" : "Action"} needs approval
        {pending.connection ? <> on <b>{pending.connection.name}</b></> : null}
        {pending.risk ? <> · <span className={high ? "text-destructive" : undefined}>{pending.risk.level} risk</span></> : null}
      </div>
      <div className="font-mono text-sm font-medium">{pending.tool}</div>
      <pre className="mt-1 text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto">
        {JSON.stringify(pending.args, null, 2)}
      </pre>
      {pending.risk?.reasons.length ? (
        <ul className="mt-1 text-[11px] text-muted-foreground list-disc pl-4">
          {pending.risk.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {high ? (
        <div className="mt-2">
          <label className="text-[11px] text-muted-foreground">
            Type <b>{confirmTarget}</b> to confirm
          </label>
          <input
            className="mt-1 w-full rounded border border-border/60 bg-background px-2 py-1 text-sm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmTarget}
            aria-label="Type to confirm"
          />
        </div>
      ) : null}
      <div className="flex gap-2 mt-2">
        <Button size="sm" disabled={!approveEnabled} onClick={() => onDecision(pending.toolCallId, "approve")}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecision(pending.toolCallId, "reject")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
