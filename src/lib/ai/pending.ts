import "server-only";

/**
 * Approvals the agent is waiting on, keyed by `<sessionId>:<toolCallId>`. The
 * session id is minted by the server per chat request (never taken from the
 * client), and each entry remembers who may decide it and — for high-risk
 * actions — what they must type, so a decision is only accepted from the user
 * who started the turn, with the confirmation the card asked for. The typed
 * confirmation used to live only in the browser, where a bare POST skipped it.
 */

export interface PendingOwner {
  /** The acting user; only they may resolve it. */
  userId: string;
  /** Text an approval must carry (the connection name for high-risk actions). */
  confirm?: string;
}

interface Entry extends PendingOwner {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** An unanswered approval is declined after this long, so a card left open
 *  can't be approved hours later into a turn that has moved on. */
export const PENDING_TTL_MS = 15 * 60 * 1000;

const globalKey = Symbol.for("baklava.aiPending");

function store(): Map<string, Entry> {
  const g = globalThis as unknown as Record<symbol, Map<string, Entry>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function key(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function settle(k: string, approved: boolean): void {
  const entry = store().get(k);
  if (!entry) return;
  store().delete(k);
  clearTimeout(entry.timer);
  entry.resolve(approved);
}

export function createPending(
  sessionId: string,
  toolCallId: string,
  owner: PendingOwner,
): Promise<boolean> {
  const k = key(sessionId, toolCallId);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => settle(k, false), PENDING_TTL_MS);
    timer.unref?.();
    store().set(k, { ...owner, resolve, timer });
  });
}

export type ResolveResult = { ok: true } | { ok: false; error: string };

export function resolvePending(
  sessionId: string,
  toolCallId: string,
  approved: boolean,
  by: { userId: string; confirm?: string },
): ResolveResult {
  const k = key(sessionId, toolCallId);
  const entry = store().get(k);
  // Someone else's approval looks exactly like a missing one.
  if (!entry || entry.userId !== by.userId) return { ok: false, error: "not-found" };
  if (approved && entry.confirm !== undefined && by.confirm?.trim() !== entry.confirm) {
    // Leave it pending: the user can still type the name, or reject.
    return { ok: false, error: "confirmation-required" };
  }
  settle(k, approved);
  return { ok: true };
}

/** Decline everything still waiting in a session (its request ended). */
export function dropPending(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const k of [...store().keys()]) {
    if (k.startsWith(prefix)) settle(k, false);
  }
}
