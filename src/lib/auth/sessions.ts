import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface SessionRecord {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number; // absolute cap (createdAt + 30d)
  userAgent: string;
}

const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
const PERSIST_THROTTLE_MS = 5 * 60 * 1000;

function getDataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function getFile(): string {
  return path.join(getDataDir(), "sessions.json");
}

const cacheKey = Symbol.for("baklava.sessionStore");
interface Store {
  byId: Map<string, SessionRecord>;
  lastPersistById: Map<string, number>;
}

function load(): Store {
  const g = globalThis as unknown as Record<symbol, Store>;
  if (g[cacheKey]) return g[cacheKey];
  const byId = new Map<string, SessionRecord>();
  try {
    const arr = JSON.parse(fs.readFileSync(getFile(), "utf8")) as SessionRecord[];
    if (Array.isArray(arr)) for (const r of arr) if (r?.id) byId.set(r.id, r);
  } catch {
    /* ENOENT or malformed → start empty */
  }
  return (g[cacheKey] = { byId, lastPersistById: new Map() });
}

function persist(store: Store): void {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${getFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...store.byId.values()], null, 2), { mode: 0o600 });
    fs.renameSync(tmp, getFile());
  } catch (err) {
    console.error(`[baklava] could not persist ${getFile()}:`, err);
  }
}

function isActive(r: SessionRecord, now: number): boolean {
  return now <= r.expiresAt && now <= r.lastSeenAt + IDLE_MS;
}

export function createSession(userAgent: string, now: number = Date.now()): SessionRecord {
  const store = load();
  const rec: SessionRecord = {
    id: randomBytes(18).toString("base64url"),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ABSOLUTE_MS,
    userAgent: (userAgent || "unknown").slice(0, 256),
  };
  store.byId.set(rec.id, rec);
  store.lastPersistById.set(rec.id, now);
  persist(store);
  return rec;
}

export function verifySession(id: string, now: number = Date.now()): boolean {
  const store = load();
  const rec = store.byId.get(id);
  if (!rec) return false;
  if (!isActive(rec, now)) {
    store.byId.delete(id);
    store.lastPersistById.delete(id);
    persist(store);
    return false;
  }
  rec.lastSeenAt = now;
  const lastP = store.lastPersistById.get(id) ?? 0;
  if (now - lastP > PERSIST_THROTTLE_MS) {
    store.lastPersistById.set(id, now);
    persist(store);
  }
  return true;
}

export function revokeSession(id: string): void {
  const store = load();
  if (store.byId.delete(id)) {
    store.lastPersistById.delete(id);
    persist(store);
  }
}

export function revokeAllExcept(keepId: string | null): void {
  const store = load();
  let changed = false;
  for (const id of [...store.byId.keys()]) {
    if (id !== keepId) {
      store.byId.delete(id);
      store.lastPersistById.delete(id);
      changed = true;
    }
  }
  if (changed) persist(store);
}

export function listSessions(now: number = Date.now()): SessionRecord[] {
  return [...load().byId.values()]
    .filter((r) => isActive(r, now))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function _resetSessionCacheForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[cacheKey];
}
