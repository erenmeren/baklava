"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Settings2, Send, Square, Pause, Play, ListChecks } from "lucide-react";
import type { ConnectionRecord } from "@/lib/connections/types";
import { isAiSupported } from "@/lib/ai/supported";
import { messageText } from "@/lib/ai/message-content";
import { toast } from "sonner";
import { ConversationList, type ConversationListItem } from "@/components/ai/conversation-list";
import { WorkingSet, type PolicyView } from "@/components/ai/working-set";
import { SlashPicker } from "@/components/ai/slash-picker";
import { MessageList, type ChatMessage, type ToolChip } from "@/components/ai/message-list";
import { ApprovalCard, type PendingApproval } from "@/components/ai/approval-card";
import { PlanCard, type ProposedPlan } from "@/components/ai/plan-card";
import { AiSettingsDialog } from "@/components/ai/ai-settings-dialog";
import { ModelPicker } from "@/components/ai/model-picker";
import { consumeAssistantStream } from "./stream";

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function AssistantClient() {
  const [allConns, setAllConns] = useState<ConnectionRecord[]>([]);
  const [rows, setRows] = useState<ConversationListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingConv, setLoadingConv] = useState(false);
  const [setIds, setSetIds] = useState<string[]>([]);
  const [policies, setPolicies] = useState<Record<string, PolicyView>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chips, setChips] = useState<ToolChip[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [plan, setPlan] = useState<ProposedPlan | null>(null);
  const [planMode, setPlanMode] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [aiPaused, setAiPaused] = useState(false);
  const sessionRef = useRef(genId());
  const planModeRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const initedRef = useRef(false);
  // Mirrors activeId so the async auto-open can tell if the user already picked
  // a conversation before the initial fetch resolved.
  const activeIdRef = useRef<string | null>(null);
  const agentDisplay = agentName.trim() || "Baklava Assistant";

  const refreshConns = useCallback(() => {
    fetch("/api/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { connections?: ConnectionRecord[] }) => setAllConns((d.connections ?? []).filter((c) => isAiSupported(c.tech))))
      .catch(() => {});
  }, []);
  const refreshList = useCallback(() => {
    fetch("/api/ai/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { conversations?: ConversationListItem[] }) => setRows(d.conversations ?? []))
      .catch(() => {});
  }, []);
  const refreshAgentName = useCallback(() => {
    fetch("/api/ai/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { settings?: { agentName?: string } }) => setAgentName(d.settings?.agentName ?? ""))
      .catch(() => {});
  }, []);

  useEffect(() => { refreshConns(); refreshAgentName(); }, [refreshConns, refreshAgentName]);
  useEffect(() => {
    fetch("/api/ai/kill-switch").then((r) => r.json()).then((d: { on?: boolean }) => setAiPaused(d.on === true)).catch(() => {});
  }, []);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Plan mode is per-conversation, persisted to localStorage. Read it whenever
  // the active conversation changes; default OFF when no conversation/key.
  useEffect(() => {
    let next = false;
    if (activeId) {
      try { next = localStorage.getItem(`baklava:plan-mode:${activeId}`) === "1"; } catch {}
    }
    planModeRef.current = next;
    setPlanMode(next);
  }, [activeId]);

  const togglePlanMode = useCallback(() => {
    setPlanMode((prev) => {
      const next = !prev;
      planModeRef.current = next;
      if (activeId) {
        try { localStorage.setItem(`baklava:plan-mode:${activeId}`, next ? "1" : "0"); } catch {}
      }
      return next;
    });
  }, [activeId]);

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
    try {
      const res = await fetch("/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "New chat", connectionIds: [] }) });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setActiveId(d.conversation.id);
      setSetIds([]); setMessages([]); setChips([]); setPending([]); setPlan(null);
      sessionRef.current = genId();
      refreshList();
    } catch {
      toast.error("Couldn't start a new chat");
    }
  }, [refreshList]);

  const selectChat = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setBusy(false);
    setActiveId(id);
    setLoadingConv(true);
    try {
      const res = await fetch(`/api/ai/conversations/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const c = d.conversation;
      setSetIds(c.connectionIds ?? []);
      (c.connectionIds ?? []).forEach(loadPolicy);
      // Render only role/text for display; tool steps are kept server-side for
      // context. Assistant content is an array of parts (text + tool-call), so
      // extract the text and drop turns that have none (tool-call-only).
      setMessages(
        (c.messages ?? [])
          .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
          .map((m: { role: "user" | "assistant"; content: unknown }) => ({ role: m.role, content: messageText(m.content) }))
          .filter((m: ChatMessage) => m.content.trim().length > 0),
      );
      setChips([]); setPending([]); setPlan(null);
      sessionRef.current = genId();
    } catch {
      toast.error("Couldn't load that conversation");
    } finally {
      setLoadingConv(false);
    }
  }, [loadPolicy]);

  // On first load, reopen the most recent conversation instead of a blank pane
  // so history is right there. Runs once; never fights a user's later selection.
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    fetch("/api/ai/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { conversations?: ConversationListItem[] }) => {
        const list = d.conversations ?? [];
        setRows(list);
        // Don't override a conversation the user clicked while this was loading.
        if (list.length > 0 && !activeIdRef.current) void selectChat(list[0].id);
      })
      .catch(() => {});
  }, [selectChat]);

  const deleteChat = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't delete conversation");
      return;
    }
    if (id === activeId) { abortRef.current?.abort(); setBusy(false); setActiveId(null); setMessages([]); setSetIds([]); }
    refreshList();
  }, [activeId, refreshList]);

  const renameChat = useCallback(async (id: string, title: string) => {
    // Optimistic: update the row immediately, roll back on failure.
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, title } : r)));
    try {
      const res = await fetch(`/api/ai/conversations/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't rename the conversation");
      refreshList();
    }
  }, [refreshList]);

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (activeId) return activeId;
    try {
      const res = await fetch("/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: input.trim().slice(0, 40) || "New chat", connectionIds: setIds }) });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setActiveId(d.conversation.id);
      refreshList();
      return d.conversation.id as string;
    } catch {
      toast.error("Couldn't start the conversation");
      return null;
    }
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
    const target = pending.find((x) => x.toolCallId === toolCallId);
    setPending((p) => p.filter((x) => x.toolCallId !== toolCallId));
    try {
      const res = await fetch("/api/ai/chat/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Use the session the approval belongs to (not the current one, which
        // may have changed if the user switched chats while the card was open).
        body: JSON.stringify({ sessionId: target?.sessionId ?? sessionRef.current, toolCallId, decision }),
      });
      const d = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
      if (!d.ok) toast.error("Couldn't deliver your decision", { description: "That request may have already ended." });
    } catch {
      toast.error("Couldn't deliver your decision");
    }
  }, [pending]);

  const decidePlan = useCallback(async (toolCallId: string, decision: "approve" | "reject") => {
    const sessionId = plan?.sessionId ?? sessionRef.current;
    setPlan(null);
    try {
      const res = await fetch("/api/ai/chat/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, toolCallId, decision }),
      });
      const d = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
      if (!d.ok) toast.error("Couldn't deliver your decision", { description: "That request may have already ended." });
    } catch {
      toast.error("Couldn't deliver your decision");
    }
  }, [plan]);

  const stop = useCallback(() => { abortRef.current?.abort(); setBusy(false); }, []);

  const toggleAiPaused = useCallback(async () => {
    const next = !aiPaused;
    setAiPaused(next);
    try {
      const res = await fetch("/api/ai/kill-switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: next }) });
      if (!res.ok) throw new Error();
      toast.success(next ? "AI actions paused" : "AI actions resumed");
    } catch {
      setAiPaused(!next);
      toast.error("Could not update");
    }
  }, [aiPaused]);

  const onInput = (v: string) => {
    setInput(v);
    if (v.endsWith("/") && (v.length === 1 || v[v.length - 2] === " ")) setPicker(true);
  };

  const send = useCallback(async () => {
    if (!input.trim() || busy) return;
    const convId = await ensureConversation();
    if (!convId) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setPlan(null);
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
          planMode: planModeRef.current,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({ error: "request failed" }));
        setMessages((m) => patchLast(m, `⚠️ ${e.error}`));
        return;
      }
      await consumeAssistantStream(res.body, {
        onTextDelta: (text) => setMessages((m) => appendLast(m, text)),
        onToolCall: (d) =>
          setChips((c) => [...c, { toolCallId: d.toolCallId, tool: d.tool, connection: d.args?.connection }]),
        onApprovalNeeded: (d) => setPending((p) => [...p, d]),
        onPlan: (d) => setPlan({ sessionId: sessionRef.current, ...d }),
        onError: (msg) => setMessages((m) => patchLast(m, `⚠️ ${msg}`)),
      });
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
        <ConversationList rows={rows} activeId={activeId} onSelect={selectChat} onNew={newChat} onDelete={deleteChat} onRename={renameChat} />
      </aside>
      <section className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
          <WorkingSet connections={setConns} policies={policies} onRemove={removeConn} onPolicyChange={changePolicy} />
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => void toggleAiPaused()}
              title={aiPaused ? "AI actions paused — click to resume" : "Pause AI actions"}
              className={aiPaused ? "inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400" : "inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"}
            >
              {aiPaused ? <><Play className="size-3" /> Resume AI</> : <><Pause className="size-3" /> Pause AI</>}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              title="AI settings"
              aria-label="AI settings"
              className="inline-flex items-center justify-center rounded-md border border-border/60 size-7 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Settings2 className="size-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loadingConv ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="h-full grid place-items-center text-center text-sm text-muted-foreground">
              <div>
                <p className="text-foreground font-medium">{agentDisplay}</p>
                <p className="mt-1">Ask anything about your connections.</p>
                <p className="mt-1 text-xs">
                  Type <kbd className="font-mono rounded border border-border px-1">/</kbd> to add one to this conversation.
                </p>
              </div>
            </div>
          ) : (
            <>
              <MessageList messages={messages} toolChips={chips} />
              {plan ? <PlanCard plan={plan} onDecision={decidePlan} /> : null}
              {pending.map((p) => (<ApprovalCard key={p.toolCallId} pending={p} onDecision={decide} />))}
            </>
          )}
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
            {busy ? (
              <button onClick={stop} title="Stop generating" aria-label="Stop generating" className="inline-flex items-center justify-center rounded-md bg-destructive px-3 text-white">
                <Square className="size-4" />
              </button>
            ) : (
              <button onClick={() => void send()} disabled={!input.trim()} title="Send message" aria-label="Send message" className="inline-flex items-center justify-center rounded-md bg-brand px-3 text-white disabled:opacity-50">
                <Send className="size-4" />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <ModelPicker onConfigure={() => setSettingsOpen(true)} />
            <button
              type="button"
              onClick={togglePlanMode}
              aria-pressed={planMode}
              title={planMode ? "Plan mode on — the assistant proposes a plan before acting" : "Plan mode off"}
              className={planMode
                ? "inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400"
                : "inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"}
            >
              <ListChecks className="size-3" /> Plan mode
            </button>
          </div>
        </div>
      </section>
      <AiSettingsDialog open={settingsOpen} onOpenChange={(v) => { setSettingsOpen(v); if (!v) refreshAgentName(); }} />
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
