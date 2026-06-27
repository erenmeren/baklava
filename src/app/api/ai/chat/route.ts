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
import { createPending } from "@/lib/ai/pending";
import { getConversation, updateConversation } from "@/lib/ai/conversation-store";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  conversationId: string;
  sessionId: string;
  connections: { id: string; tech: TechId }[];
  userMessage: { role: "user"; content: string };
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const { conversationId, sessionId, connections, userMessage } = body;

  const resolved: ConversationConnection[] = [];
  for (const c of connections ?? []) {
    const rec = getConnection(c.id);
    if (!rec || rec.tech !== c.tech || !isAiSupported(rec.tech)) continue;
    resolved.push({ id: rec.id, tech: rec.tech, name: rec.name, config: rec.config, policy: getPolicy(rec.id) });
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
        emit,
        awaitApproval: async (toolCallId, tool, args, connection) => {
          const risk = scoreAction(tool.name, tool.category, args);
          sse("approval-needed", { toolCallId, tool: tool.name, category: tool.category, args, connection, sessionId, risk });
          return createPending(sessionId, toolCallId);
        },
      });

      const systemExtra = resolved.length
        ? `Connections in this conversation: ${resolved.map((c) => `${c.name} (${c.tech})`).join(", ")}. You may only act on these.`
        : `No connections are in this conversation yet. Tell the user to add one with "/".`;

      const stored = getConversation(conversationId);
      const priorMessages = stored?.messages ?? [];
      const turnMessages: ModelMessage[] = [...priorMessages, userMessage as ModelMessage];

      // Persist the user's message up front so it survives even if this turn
      // errors mid-stream — the assistant reply (if any) is folded in on success.
      if (stored) {
        updateConversation(conversationId, {
          connectionIds: resolved.map((c) => c.id),
          messages: turnMessages,
        });
      }

      try {
        const { responseMessages } = await runAgent({
          model,
          messages: turnMessages,
          tools,
          stepCap: settings.stepCap,
          emit,
          systemExtra,
          agentName: settings.agentName,
          abortSignal: req.signal,
        });
        if (stored && responseMessages.length) {
          updateConversation(conversationId, {
            messages: [...turnMessages, ...responseMessages],
          });
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
