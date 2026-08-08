import { describe, it, expect } from "vitest";
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

  // Defect 1: the old .find() took only the first data: line. Splitting the
  // payload between JSON tokens makes the two cases distinguishable — joined
  // is valid JSON, first-line-only ('{"text":') throws and the frame is dropped.
  it("joins a payload spanning multiple data: lines", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf('event: text-delta\ndata: {"text":\ndata: "joined"}\n\n'),
      h,
    );
    expect(h.calls).toEqual(["text:joined"]);
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
