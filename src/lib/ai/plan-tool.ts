import "server-only";
import { z } from "zod";
import { createPending } from "./pending";
import type { PreparedTool } from "./prepared";

export interface PlanStep {
  tool: string;
  connection?: string;
  summary: string;
}

export const PLAN_TOOL_NAME = "propose_plan";

const planStepSchema = z.object({
  tool: z.string(),
  connection: z.string().optional(),
  summary: z.string(),
});

const planInputSchema = z.object({
  steps: z.array(planStepSchema).min(1),
  rationale: z.string().optional(),
});

const DESCRIPTION =
  "Propose a multi-step plan and wait for the user to approve or reject it before " +
  "taking any action. Use this for anything involving a write or destructive step: " +
  "list the steps you intend to run (each with its tool, optional connection, and a " +
  "one-line summary) plus an optional rationale, then act only if approved is true. " +
  "Pure read-only requests don't need a plan.";

export function makeProposePlanTool(ctx: {
  sessionId: string;
  emit: (event: string, data: unknown) => void;
  awaitDecision?: (
    toolCallId: string,
    payload: { steps: PlanStep[]; rationale?: string },
  ) => Promise<boolean>;
}): PreparedTool {
  const defaultAwait = (toolCallId: string) => createPending(ctx.sessionId, toolCallId);
  const awaitDecision = ctx.awaitDecision ?? defaultAwait;

  return {
    name: PLAN_TOOL_NAME,
    description: DESCRIPTION,
    inputSchema: planInputSchema,
    run: async (args, toolCallId) => {
      const { steps, rationale } = planInputSchema.parse(args);
      ctx.emit("plan", { toolCallId, steps, rationale });
      const approved = await awaitDecision(toolCallId, { steps, rationale });
      return { approved };
    },
  };
}
