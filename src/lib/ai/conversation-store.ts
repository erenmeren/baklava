import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelMessage } from "ai";

export interface Conversation {
  id: string;
  title: string;
  connectionIds: string[];
  messages: ModelMessage[];
  createdAt: number;
  updatedAt: number;
}

export type ConversationRow = Pick<Conversation, "id" | "title" | "connectionIds" | "createdAt" | "updatedAt">;

function dir(): string {
  const base = process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
  return path.join(base, "ai-conversations");
}
function file(id: string): string {
  return path.join(dir(), `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

const globalKey = Symbol.for("baklava.aiConversations");

function getStore(): { byId: Map<string, Conversation> } {
  const g = globalThis as unknown as Record<symbol, { byId: Map<string, Conversation> }>;
  if (!g[globalKey]) g[globalKey] = { byId: loadAll() };
  return g[globalKey];
}

function loadAll(): Map<string, Conversation> {
  const byId = new Map<string, Conversation>();
  try {
    for (const f of fs.readdirSync(dir())) {
      if (!f.endsWith(".json")) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(dir(), f), "utf8")) as Conversation;
        if (c?.id) byId.set(c.id, c);
      } catch {
        /* skip corrupt file */
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[baklava] could not read conversations:", err);
    }
  }
  return byId;
}

function persist(c: Conversation): void {
  try {
    fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
    const tmp = `${file(c.id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file(c.id));
  } catch (err) {
    console.error("[baklava] could not persist conversation:", err);
  }
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export function createConversation(input: { title: string; connectionIds: string[]; now?: number }): Conversation {
  const now = input.now ?? Date.now();
  const c: Conversation = {
    id: genId(),
    title: input.title || "New chat",
    connectionIds: input.connectionIds,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  getStore().byId.set(c.id, c);
  persist(c);
  return c;
}

export function getConversation(id: string): Conversation | undefined {
  return getStore().byId.get(id);
}

export function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, "title" | "connectionIds" | "messages">> & { now?: number },
): Conversation | undefined {
  const existing = getStore().byId.get(id);
  if (!existing) return undefined;
  const updated: Conversation = {
    ...existing,
    title: patch.title ?? existing.title,
    connectionIds: patch.connectionIds ?? existing.connectionIds,
    messages: patch.messages ?? existing.messages,
    updatedAt: patch.now ?? Date.now(),
  };
  getStore().byId.set(id, updated);
  persist(updated);
  return updated;
}

export function deleteConversation(id: string): boolean {
  const ok = getStore().byId.delete(id);
  if (ok) {
    try { fs.rmSync(file(id), { force: true }); } catch { /* ignore */ }
  }
  return ok;
}

export function listConversations(): ConversationRow[] {
  return [...getStore().byId.values()]
    .map(({ id, title, connectionIds, createdAt, updatedAt }) => ({ id, title, connectionIds, createdAt, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
