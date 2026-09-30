import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelMessage } from "ai";
import { randomUUID } from "node:crypto";
import { readSecretFileSync, writeSecretFileSync } from "@/lib/crypto/secret-file";

export interface Conversation {
  id: string;
  /** Owner of this conversation. Conversations are personal: only the owner may
   *  read/update/delete them. Empty string ("") marks an ownerless legacy
   *  conversation (persisted before per-user scoping existed) — those are
   *  fail-closed invisible to everyone (no viewer id equals ""). */
  userId: string;
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
        const text = readSecretFileSync(path.join(dir(), f));
        if (text === null) continue;
        const c = JSON.parse(text) as Conversation;
        if (c?.id) {
          // Legacy rows (pre per-user scoping) have no userId. Normalise to ""
          // so the strict-ownership filter treats them as ownerless → invisible
          // to every real user (fail closed; never leak another user's chat).
          if (typeof c.userId !== "string") c.userId = "";
          byId.set(c.id, c);
        }
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

// Conversations hold query results and tool output, so they're encrypted at
// rest like the rest of ~/.baklava (plaintext files from older versions still
// load, and are sealed on their next write).
function persist(c: Conversation): void {
  try {
    writeSecretFileSync(file(c.id), JSON.stringify(c, null, 2));
  } catch (err) {
    console.error("[baklava] could not persist conversation:", err);
  }
}

function genId(): string {
  return randomUUID();
}

export function createConversation(input: {
  userId: string;
  title: string;
  connectionIds: string[];
  now?: number;
}): Conversation {
  const now = input.now ?? Date.now();
  const c: Conversation = {
    id: genId(),
    userId: input.userId,
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

/** Does `userId` own conversation `id`? Fail closed: an empty viewer id never
 *  matches (so unauthenticated/legacy-ownerless rows are invisible to all). */
export function ownsConversation(id: string, userId: string): boolean {
  if (!userId) return false;
  const c = getStore().byId.get(id);
  return !!c && c.userId === userId;
}

/** Resolve a conversation, but only if `viewerUserId` owns it. Returns
 *  undefined otherwise — callers surface this as a 404 (hide existence). */
export function getConversation(id: string, viewerUserId: string): Conversation | undefined {
  if (!viewerUserId) return undefined;
  const c = getStore().byId.get(id);
  if (!c || c.userId !== viewerUserId) return undefined;
  return c;
}

export function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, "title" | "connectionIds" | "messages">> & { now?: number },
  viewerUserId: string,
): Conversation | undefined {
  const existing = getConversation(id, viewerUserId);
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

export function deleteConversation(id: string, viewerUserId: string): boolean {
  if (!ownsConversation(id, viewerUserId)) return false;
  const ok = getStore().byId.delete(id);
  if (ok) {
    try { fs.rmSync(file(id), { force: true }); } catch { /* ignore */ }
  }
  return ok;
}

export function listConversations(viewerUserId: string): ConversationRow[] {
  if (!viewerUserId) return [];
  return [...getStore().byId.values()]
    .filter((c) => c.userId === viewerUserId)
    .map(({ id, title, connectionIds, createdAt, updatedAt }) => ({ id, title, connectionIds, createdAt, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
