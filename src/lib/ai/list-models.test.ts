import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listModels } from "./list-models";

const realFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  })) as unknown as typeof fetch;
}

describe("listModels", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("throws before fetching when the key is empty", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(listModels("anthropic", "")).rejects.toThrow(/Missing API key/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps Anthropic models to {id,label}", async () => {
    mockFetch(200, {
      data: [
        { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
        { id: "claude-3-haiku", display_name: "" },
      ],
    });
    const models = await listModels("anthropic", "sk-ant-xxx");
    expect(models).toEqual([
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { id: "claude-3-haiku", label: "claude-3-haiku" }, // empty display falls back to id
    ]);
  });

  it("keeps only chat-capable OpenAI models and sorts them", async () => {
    mockFetch(200, {
      data: [
        { id: "text-embedding-3-small" },
        { id: "gpt-5.1" },
        { id: "whisper-1" },
        { id: "o3-mini" },
        { id: "dall-e-3" },
      ],
    });
    const ids = (await listModels("openai", "sk-xxx")).map((m) => m.id);
    expect(ids).toEqual(["gpt-5.1", "o3-mini"]);
  });

  it("keeps only generateContent Gemini models and strips the models/ prefix", async () => {
    mockFetch(200, {
      models: [
        {
          name: "models/gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          supportedGenerationMethods: ["generateContent", "countTokens"],
        },
        {
          name: "models/embedding-001",
          displayName: "Embedding",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
    const models = await listModels("google", "key");
    expect(models).toEqual([{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }]);
  });

  it("surfaces HTTP status + body when the provider rejects the key", async () => {
    mockFetch(401, '{"error":{"message":"invalid x-api-key"}}');
    await expect(listModels("anthropic", "bad")).rejects.toMatchObject({
      statusCode: 401,
      responseBody: '{"error":{"message":"invalid x-api-key"}}',
    });
  });
});

beforeEach(() => {
  // ensure each test starts from the real fetch unless it mocks
  globalThis.fetch = realFetch;
});
