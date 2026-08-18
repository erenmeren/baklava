/**
 * Bounded list results.
 *
 * Every list call used to ask the API server for everything — one response
 * carrying every pod in the cluster, straight into the RSC payload. Lists are
 * capped now, and the cap is *visible*: a truncated table says so rather than
 * quietly looking complete.
 */

/** Items per list request. High enough to cover normal clusters in one page. */
export const LIST_LIMIT = 1000;

export interface K8sList<T> {
  rows: T[];
  /** The server had more than LIST_LIMIT — the table must say so. */
  truncated: boolean;
  /** The server's estimate of how many more, when it offers one. */
  remaining: number | null;
}

interface RawList<I> {
  items?: I[];
  metadata?: { _continue?: string; remainingItemCount?: number };
}

export function toList<I, T>(list: RawList<I>, map: (item: I) => T): K8sList<T> {
  // A continue token is the API server's way of saying "there's more".
  const truncated = Boolean(list.metadata?._continue);
  return {
    rows: (list.items ?? []).map(map),
    truncated,
    remaining: truncated ? (list.metadata?.remainingItemCount ?? null) : null,
  };
}
