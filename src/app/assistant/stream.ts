import { SseFrameParser } from "@/lib/sse-client";
import type { PendingApproval } from "@/components/ai/approval-card";
import type { ProposedPlan } from "@/components/ai/plan-card";

export interface AssistantStreamHandlers {
  onTextDelta(text: string): void;
  onToolCall(data: { toolCallId: string; tool: string; args?: { connection?: string } }): void;
  onApprovalNeeded(data: PendingApproval): void;
  onPlan(data: Omit<ProposedPlan, "sessionId">): void;
  onError(message: string): void;
}

/**
 * Read an assistant SSE response body to completion, dispatching frames to
 * `handlers`. Frame parsing is delegated to the canonical SseFrameParser, which
 * joins multi-line `data:` payloads, skips `:` comments, and leaves
 * unparseable payloads as raw strings rather than throwing.
 *
 * A frame whose payload is not an object is dropped: every event this consumer
 * understands carries a JSON object, so a bare string means a malformed frame,
 * and dropping it keeps the stream alive.
 */
export async function consumeAssistantStream(
  body: ReadableStream<Uint8Array>,
  handlers: AssistantStreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseFrameParser();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
      if (typeof frame.data !== "object" || frame.data === null) continue;
      const data = frame.data as Record<string, unknown>;
      switch (frame.event) {
        case "text-delta":
          handlers.onTextDelta(String(data.text ?? ""));
          break;
        case "tool-call":
          handlers.onToolCall(data as unknown as Parameters<AssistantStreamHandlers["onToolCall"]>[0]);
          break;
        case "approval-needed":
          handlers.onApprovalNeeded(data as unknown as PendingApproval);
          break;
        case "plan":
          handlers.onPlan(data as unknown as Omit<ProposedPlan, "sessionId">);
          break;
        case "error":
          handlers.onError(String(data.error ?? "unknown error"));
          break;
        default:
          break; // forward-compatible: unknown events are ignored
      }
    }
  }
}
