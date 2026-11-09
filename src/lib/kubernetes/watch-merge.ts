/**
 * Client-side merge of a Kubernetes watch stream into a table's rows.
 *
 * The server emits rows already mapped (the same shape the page rendered);
 * this folds `reset` / `upsert` / `delete` events into the list. Pure, so the
 * rules are tested without a cluster or a browser.
 */

export interface KeyedRow {
  name: string;
  namespace?: string;
}

/** Payload of the `reset` event: a fresh bounded list plus merge hints. */
export interface WatchReset<T> {
  rows: T[];
  truncated: boolean;
  remaining: number | null;
  /**
   * Fields the watch can't know (metrics-server usage, pod counts) — the
   * mapped row carries a placeholder, so the last known value is kept.
   */
  keep: string[];
  /** New rows go on top (events), instead of at their name-sorted spot. */
  newestFirst: boolean;
}

export type LiveList<T> = WatchReset<T>;

/** Same identity ResourceTable keys its rows by. */
export function rowKey(row: KeyedRow): string {
  return `${row.namespace ?? ""}/${row.name}`;
}

function carry<T>(prev: T | undefined, next: T, keep: string[]): T {
  if (!prev || keep.length === 0) return next;
  const out = { ...next } as Record<string, unknown>;
  const old = prev as Record<string, unknown>;
  for (const k of keep) if (k in old) out[k] = old[k];
  return out as T;
}

export function applyReset<T extends KeyedRow>(
  state: LiveList<T>,
  reset: WatchReset<T>,
): LiveList<T> {
  const prev = new Map(state.rows.map((r) => [rowKey(r), r]));
  return {
    ...reset,
    rows: reset.rows.map((r) => carry(prev.get(rowKey(r)), r, reset.keep)),
  };
}

/**
 * A row changed or appeared. Changes replace in place. A new row is dropped
 * when the list is truncated: the table shows "the first N", and growing it
 * past N with whatever happened to change would make that banner a lie.
 */
export function applyUpsert<T extends KeyedRow>(state: LiveList<T>, row: T): LiveList<T> {
  const key = rowKey(row);
  const i = state.rows.findIndex((r) => rowKey(r) === key);
  if (i >= 0) {
    const rows = state.rows.slice();
    rows[i] = carry(state.rows[i], row, state.keep);
    return { ...state, rows };
  }
  if (state.truncated) return state;
  if (state.newestFirst) return { ...state, rows: [row, ...state.rows] };
  // The API lists in namespace/name order; keep a new row where a re-list would put it.
  const at = state.rows.findIndex((r) => rowKey(r) > key);
  const rows = state.rows.slice();
  rows.splice(at < 0 ? rows.length : at, 0, row);
  return { ...state, rows };
}

export function applyDelete<T extends KeyedRow>(state: LiveList<T>, key: string): LiveList<T> {
  const rows = state.rows.filter((r) => rowKey(r) !== key);
  return rows.length === state.rows.length ? state : { ...state, rows };
}
