"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Settings2, Send } from "lucide-react";
import type { ConnectionRecord } from "@/lib/connections/types";
import { parseWorkspacePath } from "@/lib/connections/first-page";
import { onOpenAssistant } from "./assistant-events";
import { ConnectionPicker } from "./connection-picker";
import { MessageList, type ChatMessage, type ToolChip } from "./message-list";
import { ApprovalCard, type PendingApproval } from "./approval-card";
import { AiSettingsDialog } from "./ai-settings-dialog";

function genSession() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function AssistantPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conn, setConn] = useState<ConnectionRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chips, setChips] = useState<ToolChip[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef(genSession());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => onOpenAssistant(() => setOpen(true)), []);
  // Pre-select the current workspace connection.
  useEffect(() => {
    if (!open || conn) return;
    const here = parseWorkspacePath(pathname);
    if (!here) return;
    fetch("/api/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { connections?: ConnectionRecord[] }) =>
        setConn((d.connections ?? []).find((c) => c.id === here.id) ?? null),
      )
      .catch(() => {});
  }, [open, pathname, conn]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const decide = useCallback(async (toolCallId: string, decision: "approve" | "reject") => {
    setPending((p) => p.filter((x) => x.toolCallId !== toolCallId));
    await fetch("/api/ai/chat/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionRef.current, toolCallId, decision }),
    }).catch(() => {});
  }, []);

  const send = useCallback(async () => {
    if (!conn || !input.trim() || busy) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId: conn.id,
          tech: conn.tech,
          sessionId: sessionRef.current,
          messages: history,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({ error: "request failed" }));
        setMessages((m) => updateLast(m, `⚠️ ${e.error}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const evLine = frame.split("\n").find((l) => l.startsWith("event: "));
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!evLine || !dataLine) continue;
          const event = evLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));
          if (event === "text-delta") setMessages((m) => appendLast(m, data.text));
          else if (event === "tool-call") setChips((c) => [...c, { toolCallId: data.toolCallId, tool: data.tool }]);
          else if (event === "approval-needed") setPending((p) => [...p, data]);
          else if (event === "error") setMessages((m) => updateLast(m, `⚠️ ${data.error}`));
        }
      }
    } catch {
      // aborted / network — leave partial text
    } finally {
      setBusy(false);
    }
  }, [conn, input, busy, messages]);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="p-4 border-b border-border/60 flex-row items-center justify-between">
            <SheetTitle className="text-base">AI Assistant</SheetTitle>
            <button onClick={() => setSettingsOpen(true)} title="AI settings" className="text-muted-foreground hover:text-foreground">
              <Settings2 className="size-4" />
            </button>
          </SheetHeader>
          <div className="p-3 border-b border-border/60">
            <ConnectionPicker value={conn} onChange={setConn} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <MessageList messages={messages} toolChips={chips} />
            {pending.map((p) => (
              <ApprovalCard key={p.toolCallId} pending={p} onDecision={decide} />
            ))}
          </div>
          <div className="p-3 border-t border-border/60 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={conn ? "Ask about this connection…" : "Pick a connection first"}
              disabled={!conn || busy}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <Button onClick={() => void send()} disabled={!conn || busy || !input.trim()} size="icon">
              <Send className="size-4" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <AiSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

function updateLast(m: ChatMessage[], content: string): ChatMessage[] {
  const copy = [...m];
  if (copy.length && copy[copy.length - 1].role === "assistant") copy[copy.length - 1] = { role: "assistant", content };
  return copy;
}
function appendLast(m: ChatMessage[], delta: string): ChatMessage[] {
  const copy = [...m];
  if (copy.length && copy[copy.length - 1].role === "assistant") {
    copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + delta };
  }
  return copy;
}
