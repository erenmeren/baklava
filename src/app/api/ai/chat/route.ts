import "server-only";
import type { ModelMessage } from "ai";
import { getConnection } from "@/lib/connections/store";
import type { TechId } from "@/lib/connections/types";
import { getSettings } from "@/lib/ai/settings";
import { modelFor } from "@/lib/ai/providers";
import { getPolicy } from "@/lib/ai/policy-store";
import { isAiSupported } from "@/lib/ai/supported";
import { scoreAction } from "@/lib/ai/risk";
import { buildConversationTools, type ConversationConnection } from "@/lib/ai/conversation-tools";
import { runAgent } from "@/lib/ai/agent";
import { makeProposePlanTool, PLAN_TOOL_NAME } from "@/lib/ai/plan-tool";
import type { PreparedTool } from "@/lib/ai/prepared";
import { createPending } from "@/lib/ai/pending";
import { getConversation, updateConversation } from "@/lib/ai/conversation-store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveAccess } from "@/lib/connections/access";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  conversationId: string;
  sessionId: string;
  connections: { id: string; tech: TechId }[];
  userMessage: { role: "user"; content: string };
  planMode?: boolean;
}

const PLAN_MODE_DIRECTIVE =
  `PLAN MODE: Before performing ANY write or destructive action, you MUST first call ` +
  `the \`${PLAN_TOOL_NAME}\` tool with the ordered steps you intend to take, then wait. ` +
  `Only after it returns { approved: true } may you execute those steps. Pure ` +
  `read/inspect actions do not require a plan. If it returns { approved: false }, stop ` +
  `and explain. Note: destructive steps will still require their own per-action approval ` +
  `during execution.`;

/**
 * Given the base systemExtra and whether plan mode is on, returns the systemExtra
 * to send plus any extra tools to append to the agent's tool array. Pulled out as a
 * pure helper so the assembly is testable without driving the full streaming handler.
 *
 * When planMode is off the base is returned untouched and no tools are added — the
 * behavior is byte-for-byte identical to a request that never had the flag.
 */
export function buildPlanAdditions(
  planMode: boolean | undefined,
  base: string,
  ctx: { sessionId: string; emit: (event: string, data: unknown) => void },
): { systemExtra: string; extraTools: PreparedTool[] } {
  if (!planMode) return { systemExtra: base, extraTools: [] };
  const systemExtra = base ? `${base}\n\n${PLAN_MODE_DIRECTIVE}` : PLAN_MODE_DIRECTIVE;
  const extraTools = [makeProposePlanTool({ sessionId: ctx.sessionId, emit: ctx.emit })];
  return { systemExtra, extraTools };
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const { conversationId, sessionId, connections, userMessage, planMode } = body;

  // Acting user (resolved from the session cookie). Behind the auth proxy this
  // should always be present; if it isn't, fail closed — every connection's
  // access becomes "none" so the gate blocks all tools.
  const user = getCurrentUser(req);

  const resolved: ConversationConnection[] = [];
  for (const c of connections ?? []) {
    const rec = getConnection(c.id);
    if (!rec || rec.tech !== c.tech || !isAiSupported(rec.tech)) continue;
    const access = user
      ? effectiveAccess({
          user: { id: user.id, role: user.role },
          conn: { id: rec.id, ownerId: rec.ownerId },
        })
      : "none";
    resolved.push({
      id: rec.id,
      tech: rec.tech,
      name: rec.name,
      config: rec.config,
      policy: getPolicy(rec.id),
      access,
    });
  }

  const settings = getSettings();
  const provider = settings.activeProvider;
  const pcfg = provider ? settings.providers[provider] : undefined;
  if (!provider || !pcfg?.apiKey) {
    return new Response(JSON.stringify({ error: "No AI provider configured. Open AI Settings." }), { status: 400 });
  }
  const model = modelFor(provider, pcfg.apiKey, pcfg.model);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };
      const sse = (event: string, data: unknown) =>
        safeEnqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const heartbeat = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), 15_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      });
      const emit = (event: string, data: unknown) => sse(event, data);

      const tools = buildConversationTools(resolved, {
        sessionId,
        userId: user?.id ?? "",
        emit,
        awaitApproval: async (toolCallId, tool, args, connection) => {
          const risk = scoreAction(tool.name, tool.category, args);
          sse("approval-needed", { toolCallId, tool: tool.name, category: tool.category, args, connection, sessionId, risk });
          return createPending(sessionId, toolCallId);
        },
      });

      const baseSystemExtra = resolved.length
        ? `Connections in this conversation: ${resolved.map((c) => `${c.name} (${c.tech})`).join(", ")}. You may only act on these.`
        : `No connections are in this conversation yet. Tell the user to add one with "/".`;

      // Plan mode (opt-in per request): appends the PLAN MODE directive and the
      // propose_plan tool, both wired to the SAME sessionId + emit the route uses
      // for approvals/SSE so the `plan` event reaches the client on this stream.
      // When off, systemExtra/tools are identical to a request without the flag.
      const { systemExtra, extraTools } = buildPlanAdditions(planMode, baseSystemExtra, {
        sessionId,
        emit,
      });
      const agentTools = extraTools.length ? [...tools, ...extraTools] : tools;

      // Load + persist scoped to the acting user. If the conversation isn't
      // owned by this user (or no user resolved), getConversation returns
      // undefined → we don't read its history or write into it. The turn still
      // streams, but it can never touch another user's conversation record.
      const viewerId = user?.id ?? "";
      const stored = getConversation(conversationId, viewerId);
      const priorMessages = stored?.messages ?? [];
      const turnMessages: ModelMessage[] = [...priorMessages, userMessage as ModelMessage];

      // Persist the user's message up front so it survives even if this turn
      // errors mid-stream — the assistant reply (if any) is folded in on success.
      if (stored) {
        updateConversation(conversationId, {
          connectionIds: resolved.map((c) => c.id),
          messages: turnMessages,
        }, viewerId);
      }

      try {
        const { responseMessages } = await runAgent({
          model,
          messages: turnMessages,
          tools: agentTools,
          stepCap: settings.stepCap,
          emit,
          systemExtra,
          agentName: settings.agentName,
          abortSignal: req.signal,
        });
        if (stored && responseMessages.length) {
          updateConversation(conversationId, {
            messages: [...turnMessages, ...responseMessages],
          }, viewerId);
        }
      } catch (err) {
        sse("error", { error: formatError(err) });
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
