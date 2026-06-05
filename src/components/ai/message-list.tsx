"use client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface ToolChip {
  toolCallId: string;
  tool: string;
  connection?: string;
}

export function MessageList({
  messages,
  toolChips,
}: {
  messages: ChatMessage[];
  toolChips: ToolChip[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m, i) => (
        <div key={i} className={m.role === "user" ? "self-end max-w-[85%]" : "self-start max-w-[85%]"}>
          <div
            className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "user" ? "bg-brand/10 text-foreground" : "bg-muted/50"
            }`}
          >
            {m.content || <span className="opacity-50">…</span>}
          </div>
        </div>
      ))}
      {toolChips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {toolChips.map((c) => (
            <span key={c.toolCallId} className="text-[10px] font-mono rounded-full border border-border px-2 py-0.5 text-muted-foreground">
              {c.tool}{c.connection ? ` ·${c.connection}` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
