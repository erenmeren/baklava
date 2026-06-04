import { describe, it, expect } from "vitest";
import { modelFor } from "./providers";

describe("modelFor", () => {
  it("builds a model for each known provider", () => {
    expect(() => modelFor("anthropic", "sk-x", "claude-sonnet-4-6")).not.toThrow();
    expect(() => modelFor("openai", "sk-x", "gpt-4.1")).not.toThrow();
    expect(() => modelFor("google", "sk-x", "gemini-2.5-pro")).not.toThrow();
  });
  it("throws on a missing api key", () => {
    expect(() => modelFor("anthropic", "", "claude-sonnet-4-6")).toThrow(/api key/i);
  });
});
