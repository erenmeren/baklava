import { describe, it, expect } from "vitest";
import { MODEL_CATALOG, PROVIDER_LABELS, labelFor } from "./model-catalog";

describe("model catalog", () => {
  it("covers exactly anthropic/openai/google with non-empty ids + labels", () => {
    const providers = Object.keys(MODEL_CATALOG).sort();
    expect(providers).toEqual(["anthropic", "google", "openai"]);
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(["anthropic", "google", "openai"]);
    for (const list of Object.values(MODEL_CATALOG)) {
      expect(list.length).toBeGreaterThan(0);
      for (const m of list) {
        expect(m.id.trim().length).toBeGreaterThan(0);
        expect(m.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("labelFor returns the label for a known id, raw id otherwise", () => {
    expect(labelFor("anthropic", "claude-sonnet-4-6")).toBe("Claude Sonnet 4.6");
    expect(labelFor("anthropic", "some-future-id")).toBe("some-future-id");
  });
});
