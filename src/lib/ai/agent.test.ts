import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AI SDK so we control what the stream yields and how
// `result.response` settles. `tool`/`stepCountIs` are passthrough stubs.
const streamTextMock = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  stepCountIs: (n: number) => n,
  tool: (def: unknown) => def,
}));

import { runAgent } from "./agent";

function fakeResult(parts: unknown[], response: Promise<unknown>) {
  return {
    fullStream: (async function* () {
      for (const p of parts) yield p;
    })(),
    response,
  };
}

function collect() {
  const events: { event: string; data: { error?: string; text?: string } }[] = [];
  return {
    events,
    emit: (event: string, data: unknown) =>
      events.push({ event, data: data as { error?: string } }),
  };
}

const baseArgs = { model: {} as never, messages: [], tools: [], stepCap: 12 };

describe("runAgent error surfacing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces the real provider error and does NOT let 'No output generated' mask it", async () => {
    const apiErr = Object.assign(new Error("Bad Gateway"), {
      statusCode: 502,
      responseBody: '{"error":"upstream unavailable"}',
    });
    // The SDK rejects result.response with a generic error after the stream errors.
    const noOutput = new Error("No output generated. Check the stream for errors.");

    streamTextMock.mockReturnValue(
      fakeResult([{ type: "error", error: apiErr }], Promise.reject(noOutput)),
    );

    const { events, emit } = collect();
    const out = await runAgent({ ...baseArgs, emit });

    const errors = events.filter((e) => e.event === "error").map((e) => e.data.error);
    expect(errors).toContain('HTTP 502: {"error":"upstream unavailable"}');
    // The generic SDK message must never reach the user — it masks the real cause.
    expect(errors).not.toContain("No output generated. Check the stream for errors.");
    // No spurious success signal, and nothing persisted.
    expect(events.some((e) => e.event === "done")).toBe(false);
    expect(out.responseMessages).toEqual([]);
  });

  it("injects a custom agent name into the system prompt", async () => {
    streamTextMock.mockReturnValue(
      fakeResult([], Promise.resolve({ messages: [] })),
    );
    const { emit } = collect();
    await runAgent({ ...baseArgs, emit, agentName: "Jarvis" });
    const system = streamTextMock.mock.calls[0][0].system as string;
    expect(system).toContain("You are Jarvis, Baklava's operations assistant.");
  });

  it("falls back to the default identity when no name is set", async () => {
    streamTextMock.mockReturnValue(
      fakeResult([], Promise.resolve({ messages: [] })),
    );
    const { emit } = collect();
    await runAgent({ ...baseArgs, emit });
    const system = streamTextMock.mock.calls[0][0].system as string;
    expect(system).toContain("You are Baklava's operations assistant.");
    expect(system).not.toContain("undefined");
  });

  it("emits text deltas and done on a successful stream", async () => {
    streamTextMock.mockReturnValue(
      fakeResult(
        [{ type: "text-delta", text: "hi" }],
        Promise.resolve({ messages: [{ role: "assistant", content: "hi" }] }),
      ),
    );

    const { events, emit } = collect();
    const out = await runAgent({ ...baseArgs, emit });

    expect(events.find((e) => e.event === "text-delta")?.data.text).toBe("hi");
    expect(events.some((e) => e.event === "done")).toBe(true);
    expect(events.some((e) => e.event === "error")).toBe(false);
    expect(out.responseMessages).toHaveLength(1);
  });

  it("captures an error thrown while iterating the stream", async () => {
    const boom = Object.assign(new Error("boom"), { statusCode: 500, responseBody: "upstream blew up" });
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {
        throw boom;
      })(),
      response: Promise.resolve({ messages: [] }),
    });

    const { events, emit } = collect();
    const out = await runAgent({ ...baseArgs, emit });

    const errors = events.filter((e) => e.event === "error").map((e) => e.data.error);
    expect(errors).toContain("HTTP 500: upstream blew up");
    expect(events.some((e) => e.event === "done")).toBe(false);
    expect(out.responseMessages).toEqual([]);
  });

  it("surfaces an error when result.response rejects on an otherwise clean stream", async () => {
    const err = Object.assign(new Error("late failure"), { statusCode: 429, responseBody: "rate limited" });
    streamTextMock.mockReturnValue(
      fakeResult([{ type: "text-delta", text: "partial" }], Promise.reject(err)),
    );

    const { events, emit } = collect();
    const out = await runAgent({ ...baseArgs, emit });

    const errors = events.filter((e) => e.event === "error").map((e) => e.data.error);
    expect(errors).toContain("HTTP 429: rate limited");
    expect(out.responseMessages).toEqual([]);
  });
});
