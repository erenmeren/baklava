"use client";
import { Button } from "@/components/ui/button";

export interface ProposedPlan {
  toolCallId: string;
  /** Session the plan belongs to — used to route the decision correctly. */
  sessionId?: string;
  steps: { tool: string; connection?: string; summary: string }[];
  rationale?: string;
}

export function PlanCard({
  plan,
  onDecision,
}: {
  plan: ProposedPlan;
  onDecision: (toolCallId: string, decision: "approve" | "reject") => void;
}) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 my-2">
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
        Plan proposed — review before it runs
      </div>
      {plan.rationale ? (
        <p className="text-sm text-foreground/90 mb-2">{plan.rationale}</p>
      ) : null}
      {/* Steps are untrusted model DATA — render as plain text only. */}
      <ol className="space-y-1.5 list-decimal pl-5">
        {plan.steps.map((s, i) => (
          <li key={i} className="text-sm">
            <span className="font-mono text-xs rounded bg-muted/60 px-1 py-0.5">{s.tool}</span>
            {s.connection ? (
              <span className="text-muted-foreground"> on <b className="font-medium">{s.connection}</b></span>
            ) : null}
            <div className="text-muted-foreground">{s.summary}</div>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 mt-3">
        <Button size="sm" onClick={() => onDecision(plan.toolCallId, "approve")}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecision(plan.toolCallId, "reject")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
