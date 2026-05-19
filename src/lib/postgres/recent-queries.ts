/**
 * Per-connection recent-queries store. Aggregates across every SQL
 * editor tab in the connection — the regular editor history is per-
 * (connection, db, queryId), so this is the wider net the Cmd+K palette
 * and a future "Recent" panel can search across.
 *
 * Persisted to localStorage. Capped at HARD_CAP entries; oldest dropped
 * when full. Identical SQL on the same DB is deduplicated by bumping
 * the existing entry's `at`.
 */

export interface RecentQuery {
  /** The exact SQL the user ran. */
  sql: string;
  /** Database it was run against. */
  database: string;
  /** Duration in milliseconds (best-effort; from server when available). */
  durationMs?: number;
  /** Server-reported row count when available; null on error. */
  rowCount?: number | null;
  /** Whether the run succeeded. */
  ok: boolean;
  /** Timestamp in milliseconds since epoch. */
  at: number;
}

const HARD_CAP = 200;
const KEY_PREFIX = "baklava:pg:recent:";

function storageKey(connectionId: string): string {
  return `${KEY_PREFIX}${connectionId}`;
}

export function loadRecentQueries(connectionId: string): RecentQuery[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(connectionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentQuery[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushRecentQuery(
  connectionId: string,
  entry: RecentQuery,
): RecentQuery[] {
  if (typeof window === "undefined") return [];
  const sql = entry.sql.trim();
  if (!sql) return loadRecentQueries(connectionId);
  const existing = loadRecentQueries(connectionId);

  // Deduplicate: if the same SQL on the same DB is already at the top
  // within the last 60s, just bump it (avoids flooding the list with
  // accidental double-runs).
  const head = existing[0];
  if (
    head &&
    head.sql === sql &&
    head.database === entry.database &&
    entry.at - head.at < 60_000
  ) {
    const next = [{ ...head, ...entry, sql, at: entry.at }, ...existing.slice(1)];
    saveAll(connectionId, next);
    return next;
  }

  // Drop any deeper duplicate (same SQL + DB) so we don't grow stale.
  const filtered = existing.filter(
    (q) => !(q.sql === sql && q.database === entry.database),
  );
  const next = [{ ...entry, sql }, ...filtered].slice(0, HARD_CAP);
  saveAll(connectionId, next);
  return next;
}

export function clearRecentQueries(connectionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(connectionId));
  } catch {
    // ignore
  }
}

function saveAll(connectionId: string, list: RecentQuery[]): void {
  try {
    window.localStorage.setItem(
      storageKey(connectionId),
      JSON.stringify(list),
    );
    // Notify any subscribers in this tab.
    window.dispatchEvent(
      new CustomEvent("baklava:pg-recent-changed", {
        detail: { connectionId },
      }),
    );
  } catch {
    // localStorage may be full / disabled — silently ignore.
  }
}

/**
 * Subscribe to recent-query changes in this tab. Returns an unsubscribe.
 * `storage` events fire across tabs; the custom event covers same-tab.
 */
export function subscribeRecentQueries(
  connectionId: string,
  cb: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const key = storageKey(connectionId);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) cb();
  };
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent).detail as { connectionId?: string };
    if (detail?.connectionId === connectionId) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("baklava:pg-recent-changed", onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("baklava:pg-recent-changed", onCustom);
  };
}
