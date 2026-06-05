"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Settings2, Send } from "lucide-react";
import type { ConnectionRecord } from "@/lib/connections/types";
import { isAiSupported } from "@/lib/ai/supported";
import { ConversationList, type ConversationRow } from "@/components/ai/conversation-list";
import { WorkingSet, type PolicyView } from "@/components/ai/working-set";
import { SlashPicker } from "@/components/ai/slash-picker";
import { MessageList, type ChatMessage, type ToolChip } from "@/components/ai/message-list";
import { ApprovalCard, type PendingApproval } from "@/components/ai/approval-card";
import { AiSettingsDialog } from "@/components/ai/ai-settings-dialog";

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function AssistantClient() {
  const [allConns, setAllConns] = useState<ConnectionRecord[]>([]);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [setIds, setSetIds] = useState<string[]>([]);
  const [policies, setPolicies] = useState<Record<string, PolicyView>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chips, setChips] = useState<ToolChip[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sessionRef = useRef(genId());
  const abortRef = useRef<AbortController | null>(null);

  const refreshConns = useCallback(() => {
    fetch("/api/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { connections?: ConnectionRecord[] }) => setAllConns((d.connections ?? []).filter((c) => isAiSupported(c.tech))))
      .catch(() => {});
  }, []);
  const refreshList = useCallback(() => {
    fetch("/api/ai/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { conversations?: ConversationRow[] }) => setRows(d.conversations ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { refreshConns(); refreshList(); }, [refreshConns, refreshList]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const setConns = setIds.map((id) => allConns.find((c) => c.id === id)).filter(Boolean) as ConnectionRecord[];
  const candidates = allConns.filter((c) => !setIds.includes(c.id));

  const loadPolicy = useCallback((id: string) => {
    fetch(`/api/ai/connections/${id}/policy`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { policy?: PolicyView }) => { if (d.policy) setPolicies((p) => ({ ...p, [id]: d.policy! })); })
      .catch(() => {});
  }, []);

  const newChat = useCallback(async () => {
    abortRef.current?.abort();
    setBusy(false);
    const res = await fetch("/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "New chat", connectionIds: [] }) });
    const d = await res.json();
    setActiveId(d.conversation.id);
    setSetIds([]); setMessages([]); setChips([]); setPending([]);
    sessionRef.current = genId();
    refreshList();
  }, [refreshList]);

  const selectChat = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setBusy(false);
    const res = await fetch(`/api/ai/conversations/${id}`, { cache: "no-store" });
    const d = await res.json();
    const c = d.conversation;
    setActiveId(id);
    setSetIds(c.connectionIds ?? []);
    (c.connectionIds ?? []).forEach(loadPolicy);
    // Render only role/text for display; tool steps are kept server-side for context.
    setMessages((c.messages ?? []).filter((m: { role: string }) => m.role === "user" || m.role === "assistant").map((m: { role: "user" | "assistant"; content: unknown }) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" })));
    setChips([]); setPending([]);
    sessionRef.current = genId();
  }, [loadPolicy]);

  const deleteChat = useCallback(async (id: string) => {
    await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
    if (id === activeId) { abortRef.current?.abort(); setBusy(false); setActiveId(null); setMessages([]); setSetIds([]); }
    refreshList();
  }, [activeId, refreshList]);

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (activeId) return activeId;
    const res = await fetch("/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: input.trim().slice(0, 40) || "New chat", connectionIds: setIds }) });
    const d = await res.json();
    setActiveId(d.conversation.id);
    refreshList();
    return d.conversation.id as string;
  }, [activeId, input, setIds, refreshList]);

  const addConn = useCallback((c: ConnectionRecord) => {
    setSetIds((ids) => (ids.includes(c.id) ? ids : [...ids, c.id]));
    loadPolicy(c.id);
    setPicker(false);
    setInput((v) => v.replace(/\/$/, ""));
  }, [loadPolicy]);

  const removeConn = useCallback((id: string) => setSetIds((ids) => ids.filter((x) => x !== id)), []);

  const changePolicy = useCallback((id: string, p: PolicyView) => {
    setPolicies((prev) => ({ ...prev, [id]: p }));
    void fetch(`/api/ai/connections/${id}/policy`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
  }, []);

  const decide = useCallback(async (toolCallId: string, decision: "approve" | "reject") => {
    setPending((p) => p.filter((x) => x.toolCallId !== toolCallId));
    await fetch("/api/ai/chat/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionRef.current, toolCallId, decision }) }).catch(() => {});
  }, []);

  const onInput = (v: string) => {
    setInput(v);
    if (v.endsWith("/") && (v.length === 1 || v[v.length - 2] === " ")) setPicker(true);
  };

  const send = useCallback(async () => {
    if (!input.trim() || busy) return;
    const convId = await ensureConversation();
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
          conversationId: convId,
          sessionId: sessionRef.current,
          connections: setConns.map((c) => ({ id: c.id, tech: c.tech })),
          userMessage: { role: "user", content: userMsg.content },
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({ error: "request failed" }));
        setMessages((m) => patchLast(m, `⚠️ ${e.error}`));
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
          const ev = frame.split("\n").find((l) => l.startsWith("event: "));
          const dl = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!ev || !dl) continue;
          const event = ev.slice(7).trim();
          const data = JSON.parse(dl.slice(6));
          if (event === "text-delta") setMessages((m) => appendLast(m, data.text));
          else if (event === "tool-call") setChips((c) => [...c, { toolCallId: data.toolCallId, tool: data.tool, connection: (data.args as { connection?: string })?.connection }]);
          else if (event === "approval-needed") setPending((p) => [...p, data]);
          else if (event === "error") setMessages((m) => patchLast(m, `⚠️ ${data.error}`));
        }
      }
      refreshList();
    } catch {
      /* aborted / network */
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages, setConns, ensureConversation, refreshList]);

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <aside className="w-60 shrink-0 border-r border-border/60 bg-sidebar">
        <ConversationList rows={rows} activeId={activeId} onSelect={selectChat} onNew={newChat} onDelete={deleteChat} />
      </aside>
      <section className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
          <WorkingSet connections={setConns} policies={policies} onRemove={removeConn} onPolicyChange={changePolicy} />
          <button onClick={() => setSettingsOpen(true)} title="AI settings" className="text-muted-foreground hover:text-foreground shrink-0">
            <Settings2 className="size-4" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <MessageList messages={messages} toolChips={chips} />
          {pending.map((p) => (<ApprovalCard key={p.toolCallId} pending={p} onDecision={decide} />))}
        </div>
        <div className="relative border-t border-border/60 p-3">
          {picker ? (
            <SlashPicker candidates={candidates} onPick={addConn} onClose={() => setPicker(false)} />
          ) : null}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder='Ask anything — type "/" to add a connection'
              disabled={busy}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button onClick={() => void send()} disabled={busy || !input.trim()} className="inline-flex items-center justify-center rounded-md bg-brand px-3 text-white disabled:opacity-50">
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </section>
      <AiSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function patchLast(m: ChatMessage[], content: string): ChatMessage[] {
  const copy = [...m];
  if (copy.length && copy[copy.length - 1].role === "assistant") copy[copy.length - 1] = { role: "assistant", content };
  return copy;
}
function appendLast(m: ChatMessage[], delta: string): ChatMessage[] {
  const copy = [...m];
  if (copy.length && copy[copy.length - 1].role === "assistant") copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + delta };
  return copy;
}
