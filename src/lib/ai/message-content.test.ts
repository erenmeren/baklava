import { describe, it, expect } from "vitest";
import { messageText } from "./message-content";

describe("messageText", () => {
  it("returns a plain string unchanged (user message)", () => {
    expect(messageText("what are my containers?")).toBe("what are my containers?");
  });

  it("joins text parts from an array-form assistant message", () => {
    const content = [
      { type: "text", text: "I'll check your containers. " },
      { type: "tool-call", toolCallId: "t1", toolName: "docker_list_containers" },
      { type: "text", text: "Here is what I found." },
    ];
    expect(messageText(content)).toBe("I'll check your containers. Here is what I found.");
  });

  it("returns empty string for a tool-call-only assistant turn", () => {
    const content = [{ type: "tool-call", toolCallId: "t1", toolName: "x" }];
    expect(messageText(content)).toBe("");
  });

  it("ignores tool-result parts and non-text shapes", () => {
    expect(messageText([{ type: "tool-result", toolCallId: "t1", output: {} }])).toBe("");
    expect(messageText(null)).toBe("");
    expect(messageText(undefined)).toBe("");
    expect(messageText(42)).toBe("");
  });
});
