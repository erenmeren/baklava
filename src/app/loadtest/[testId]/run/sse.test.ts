// src/app/loadtest/[testId]/run/sse.test.ts
import { describe, it, expect } from "vitest";
import { SseFrameParser } from "./sse";

describe("SseFrameParser", () => {
  it("parses complete frames split across chunks", () => {
    const p = new SseFrameParser();
    const a = p.push("event: progress\ndata: {\"line\":\"hi\"}\n\n");
    expect(a).toEqual([{ event: "progress", data: { line: "hi" } }]);
    const b = p.push("event: done\ndata: {\"runId\":\"r1\",\"st");
    expect(b).toEqual([]); // incomplete
    const c = p.push("atus\":\"passed\"}\n\n");
    expect(c).toEqual([{ event: "done", data: { runId: "r1", status: "passed" } }]);
  });

  it("ignores heartbeat comment lines", () => {
    const p = new SseFrameParser();
    expect(p.push(": ping\n\n")).toEqual([]);
  });

  it("parses two frames in one chunk", () => {
    const p = new SseFrameParser();
    const out = p.push('event: progress\ndata: {"line":"a"}\n\nevent: progress\ndata: {"line":"b"}\n\n');
    expect(out).toEqual([
      { event: "progress", data: { line: "a" } },
      { event: "progress", data: { line: "b" } },
    ]);
  });
});
