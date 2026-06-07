// A stored ModelMessage's `content` is either a plain string (user messages) or
// an array of parts (assistant/tool messages: text, tool-call, tool-result).
// The chat UI renders plain text, so pull the text parts out and join them.
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (p): p is { type: string; text: string } =>
          !!p &&
          typeof p === "object" &&
          (p as { type?: unknown }).type === "text" &&
          typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join("");
  }
  return "";
}
