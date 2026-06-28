import { formatError } from "@/lib/errors";
import { isAllowed, needsApproval, type PermissionPolicy } from "./permissions";
import { appendAudit } from "./audit";
import { isKillSwitchOn } from "./kill-switch";
import { checkRateLimit } from "./limits";
import type { AiTool } from "./tools/types";

export interface GateContext {
  policy: PermissionPolicy;
  connectionId: string;
  sessionId: string;
  userId: string;
  /** Acting user's effective access to this connection. Fail-closed: "none". */
  connectionAccess: "none" | "read" | "write";
  emit: (event: string, data: unknown) => void;
  awaitApproval: (toolCallId: string, tool: AiTool, args: unknown) => Promise<boolean>;
  now?: () => number;
}

export function wrapExecute(tool: AiTool, ctx: GateContext) {
  const now = ctx.now ?? (() => Date.now());
  return async (args: Record<string, unknown>, toolCallId = "unknown"): Promise<unknown> => {
    const base = {
      tool: tool.name,
      category: tool.category,
      connectionId: ctx.connectionId,
      userId: ctx.userId,
      args,
    };

    // Global kill switch: pause everything except reads.
    if (tool.category !== "read" && isKillSwitchOn()) {
      appendAudit(ctx.sessionId, { ...base, decision: "blocked", summary: "kill-switch", at: now() });
      ctx.emit("blocked", { tool: tool.name, reason: "kill-switch" });
      return { error: `AI actions are paused (kill switch is on). Re-enable it in Settings to continue.` };
    }

    // Per-user connection access (RBAC). Reads need at least "read"; writes and
    // destructive actions need "write". Fail-closed when access is "none".
    const accessOk =
      tool.category === "read"
        ? ctx.connectionAccess !== "none"
        : ctx.connectionAccess === "write";
    if (!accessOk) {
      appendAudit(ctx.sessionId, { ...base, decision: "blocked", summary: "no-access", at: now() });
      ctx.emit("blocked", { tool: tool.name, reason: "no-access" });
      return { error: `You don't have access to perform "${tool.name}" on this connection.` };
    }

    if (!isAllowed(tool.category, ctx.policy)) {
      appendAudit(ctx.sessionId, { ...base, decision: "blocked", at: now() });
      return { error: `Action "${tool.name}" is not permitted by this connection's policy.` };
    }

    if (needsApproval(tool.category, ctx.policy)) {
      const approved = await ctx.awaitApproval(toolCallId, tool, args);
      if (!approved) {
        appendAudit(ctx.sessionId, { ...base, decision: "rejected", at: now() });
        return { declined: true, message: `User declined "${tool.name}".` };
      }
    }

    // Rate limit / circuit breaker / budget — counted only for actions we will
    // actually run (after approval), at the one chokepoint.
    const limit = checkRateLimit({
      sessionId: ctx.sessionId,
      connectionId: ctx.connectionId,
      category: tool.category,
      now: now(),
    });
    if (!limit.allowed) {
      appendAudit(ctx.sessionId, { ...base, decision: "blocked", summary: limit.reason, at: now() });
      ctx.emit("blocked", { tool: tool.name, reason: limit.reason });
      return { error: `Action blocked: ${limit.reason}.` };
    }

    try {
      const result = await tool.execute(args);
      ctx.emit("tool-result", { toolCallId, tool: tool.name, ok: true });
      appendAudit(ctx.sessionId, { ...base, decision: "executed", at: now() });
      return result;
    } catch (err) {
      const message = formatError(err);
      ctx.emit("tool-result", { toolCallId, tool: tool.name, ok: false, error: message });
      appendAudit(ctx.sessionId, { ...base, decision: "error", summary: message, at: now() });
      return { error: message };
    }
  };
}
