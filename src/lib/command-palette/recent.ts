const KEY = "baklava:recent-connections";
const CAP = 8;

/** Pure LRU step — exported for testing. */
export function computeRecent(prev: string[], id: string, cap = CAP): string[] {
  return [id, ...prev.filter((x) => x !== id)].slice(0, cap);
}

export function getRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function recordVisit(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(computeRecent(getRecent(), id)));
  } catch {
    /* ignore */
  }
}
