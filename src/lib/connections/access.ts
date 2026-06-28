import os from "node:os";
import path from "node:path";
import { readSecretFileSync, writeSecretFileSync } from "@/lib/crypto/secret-file";

// ─────────────────────────────────────────────────────────────────────────────
// Per-user connection access grants (RBAC).
//
// A connection's owner and admins always get "write". Everyone else gets the
// explicit grant recorded here, or "none". Grants live in an encrypted file
// under DATA_DIR and are cached on globalThis so they survive Next dev HMR.
// ─────────────────────────────────────────────────────────────────────────────

export type AccessLevel = "read" | "write";

function getDataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function getFile(): string {
  return path.join(getDataDir(), "connection-access.json");
}

// connectionId -> userId -> AccessLevel
type GrantMap = Record<string, Record<string, AccessLevel>>;

interface PersistedShape {
  version: 1;
  grants: GrantMap;
}

const cacheKey = Symbol.for("baklava.connectionAccess");
interface Cache {
  grants: GrantMap;
}

function loadFromDisk(): GrantMap {
  try {
    const raw = readSecretFileSync(getFile());
    if (raw == null) return {};
    const data = JSON.parse(raw) as Partial<PersistedShape>;
    if (data?.grants && typeof data.grants === "object") {
      return data.grants as GrantMap;
    }
    return {};
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`[baklava] could not read ${getFile()}:`, err);
    }
    return {};
  }
}

function getCache(): Cache {
  const g = globalThis as unknown as Record<symbol, Cache>;
  if (!g[cacheKey]) {
    g[cacheKey] = { grants: loadFromDisk() };
  }
  return g[cacheKey];
}

function persist(cache: Cache): void {
  try {
    const payload: PersistedShape = { version: 1, grants: cache.grants };
    writeSecretFileSync(getFile(), JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error(`[baklava] could not persist ${getFile()}:`, err);
  }
}

export function getGrants(connectionId: string): Record<string, AccessLevel> {
  return { ...(getCache().grants[connectionId] ?? {}) };
}

export function setGrants(
  connectionId: string,
  grants: Record<string, AccessLevel>
): void {
  const cache = getCache();
  const clean: Record<string, AccessLevel> = {};
  for (const [userId, level] of Object.entries(grants)) {
    if (level === "read" || level === "write") clean[userId] = level;
  }
  if (Object.keys(clean).length === 0) {
    delete cache.grants[connectionId];
  } else {
    cache.grants[connectionId] = clean;
  }
  persist(cache);
}

export function dropConnectionGrants(connectionId: string): void {
  const cache = getCache();
  if (connectionId in cache.grants) {
    delete cache.grants[connectionId];
    persist(cache);
  }
}

export function effectiveAccess(args: {
  user: { id: string; role: "admin" | "member" };
  conn: { id: string; ownerId?: string };
}): "none" | "read" | "write" {
  const { user, conn } = args;
  if (user.role === "admin") return "write";
  if (conn.ownerId && conn.ownerId === user.id) return "write";
  return getCache().grants[conn.id]?.[user.id] ?? "none";
}

/** Test-only: drop the globalThis-cached grant map. */
export function _resetAccessCacheForTests(): void {
  delete (globalThis as Record<symbol, unknown>)[cacheKey];
}
