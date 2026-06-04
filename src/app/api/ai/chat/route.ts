import "server-only";
import type { ModelMessage } from "ai";
import { getConnection } from "@/lib/connections/store";
import type { TechId } from "@/lib/connections/types";
import { getSettings } from "@/lib/ai/settings";
import { modelFor } from "@/lib/ai/providers";
import { getPolicy } from "@/lib/ai/policy-store";
import { buildTools, isAiSupported } from "@/lib/ai/tools/registry";
import { runAgent } from "@/lib/ai/agent";
import { createPending } from "@/lib/ai/pending";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  connectionId: string;
  tech: TechId;
  sessionId: string;
  messages: ModelMessage[];
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { connectionId, tech, sessionId, messages } = body;
  if (!isAiSupported(tech)) {
    return new Response(JSON.stringify({ error: `AI not supported for ${tech} yet` }), { status: 400 });
  }

  const record = getConnection(connectionId);
  if (!record || record.tech !== tech) {
    return new Response(JSON.stringify({ error: "Connection not found" }), { status: 404 });
  }

  const settings = getSettings();
  const provider = settings.activeProvider;
  const pcfg = provider ? settings.providers[provider] : undefined;
  if (!provider || !pcfg?.apiKey) {
    return new Response(JSON.stringify({ error: "No AI provider configured. Open AI Settings." }), { status: 400 });
  }

  const policy = getPolicy(connectionId);
  const tools = buildTools(tech, connectionId, record.config, policy);
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

      try {
        await runAgent({
          model,
          messages,
          tools,
          stepCap: settings.stepCap,
          emit,
          gate: {
            policy,
            connectionId,
            sessionId,
            emit,
            awaitApproval: async (toolCallId, tool, args) => {
              sse("approval-needed", { toolCallId, tool: tool.name, category: tool.category, args });
              return createPending(sessionId, toolCallId);
            },
          },
          abortSignal: req.signal,
        });
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
