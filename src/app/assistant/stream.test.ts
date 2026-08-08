import { describe, it, expect, vi } from "vitest";
import { streamOf } from "@/test/sse";
import { consumeAssistantStream, type AssistantStreamHandlers } from "./stream";

function handlers(): AssistantStreamHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onTextDelta: (t) => calls.push(`text:${t}`),
    onToolCall: (d) => calls.push(`tool:${d.tool}`),
    onApprovalNeeded: (d) => calls.push(`approval:${d.toolCallId}`),
    onPlan: () => calls.push("plan"),
    onError: (m) => calls.push(`error:${m}`),
  };
}

describe("consumeAssistantStream", () => {
  it("dispatches each event type to its handler", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf(
        'event: text-delta\ndata: {"text":"hi"}\n\n',
        'event: tool-call\ndata: {"toolCallId":"t1","tool":"pg_list_tables"}\n\n',
        'event: error\ndata: {"error":"boom"}\n\n',
      ),
      h,
    );
    expect(h.calls).toEqual(["text:hi", "tool:pg_list_tables", "error:boom"]);
  });

  it("reassembles a payload split across chunk boundaries", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf('event: text-delta\ndata: {"te', 'xt":"split"}\n\n'),
      h,
    );
    expect(h.calls).toEqual(["text:split"]);
  });

  // Defect 1: the old .find() took only the first data: line.
  it("joins a payload spanning multiple data: lines", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf(
        'event: text-delta\ndata: line one\ndata: line two\n\n',
        'event: text-delta\ndata: {"text":"after multi-line"}\n\n',
      ),
      h,
    );
    // First frame: multi-line non-JSON is skipped, but stream continues (fixes both defects)
    // Second frame: valid JSON is processed
    expect(h.calls).toEqual(["text:after multi-line"]);
  });

  // Defect 2: the old unguarded JSON.parse killed the whole stream.
  it("survives a non-JSON data line and keeps consuming", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf(
        "event: text-delta\ndata: not json\n\n",
        'event: text-delta\ndata: {"text":"after"}\n\n',
      ),
      h,
    );
    expect(h.calls).toEqual(["text:after"]);
  });

  it("ignores heartbeat comments", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf(": ping\n\n", 'event: text-delta\ndata: {"text":"ok"}\n\n'),
      h,
    );
    expect(h.calls).toEqual(["text:ok"]);
  });

  it("ignores unknown event names without throwing", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf('event: future-thing\ndata: {"x":1}\n\n'),
      h,
    );
    expect(h.calls).toEqual([]);
  });
});
