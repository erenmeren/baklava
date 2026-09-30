import "server-only";

export type LimitCategory = "read" | "write" | "destructive";

export interface LimitConfig {
  sessionBudget: number;
  rateWindowMs: number;
  rateMax: number;
  destructiveWindowMs: number;
  destructiveMax: number;
}

export const DEFAULT_LIMITS: LimitConfig = {
  sessionBudget: 300,
  rateWindowMs: 10_000,
  rateMax: 40,
  destructiveWindowMs: 60_000,
  destructiveMax: 8,
};

interface LimitState {
  totalBySession: Map<string, number>;
  callsByKey: Map<string, number[]>;
  destructiveByUser: Map<string, number[]>;
}

const globalKey = Symbol.for("baklava.aiLimits");
function state(): LimitState {
  const g = globalThis as unknown as Record<symbol, LimitState>;
  if (!g[globalKey]) {
    g[globalKey] = {
      totalBySession: new Map(),
      callsByKey: new Map(),
      destructiveByUser: new Map(),
    };
  }
  return g[globalKey];
}

/**
 * `sessionId` is minted by the server per chat turn, so the call budget is per
 * turn. The time-windowed limits — rate and the destructive breaker — are
 * keyed by `userId`: keyed by session, every new turn (or, before sessions were
 * server-minted, every made-up id) got a fresh window.
 */
export interface CheckArgs {
  sessionId: string;
  userId: string;
  connectionId: string;
  category: LimitCategory;
  now?: number;
  config?: LimitConfig;
}

export function checkRateLimit(args: CheckArgs): { allowed: boolean; reason?: string } {
  const cfg = args.config ?? DEFAULT_LIMITS;
  const now = args.now ?? Date.now();
  const s = state();

  const total = s.totalBySession.get(args.sessionId) ?? 0;
  if (total >= cfg.sessionBudget) {
    return { allowed: false, reason: `session tool-call budget reached (${cfg.sessionBudget})` };
  }

  const rkey = `${args.userId}:${args.connectionId}`;
  const calls = (s.callsByKey.get(rkey) ?? []).filter((t) => now - t < cfg.rateWindowMs);
  if (calls.length >= cfg.rateMax) {
    return { allowed: false, reason: "rate limit: too many actions in a short window" };
  }

  if (args.category === "destructive") {
    const ds = (s.destructiveByUser.get(args.userId) ?? []).filter(
      (t) => now - t < cfg.destructiveWindowMs,
    );
    if (ds.length >= cfg.destructiveMax) {
      return { allowed: false, reason: "too many destructive actions in a row — paused, try again shortly" };
    }
  }

  s.totalBySession.set(args.sessionId, total + 1);
  calls.push(now);
  s.callsByKey.set(rkey, calls);
  if (args.category === "destructive") {
    const ds = (s.destructiveByUser.get(args.userId) ?? []).filter(
      (t) => now - t < cfg.destructiveWindowMs,
    );
    ds.push(now);
    s.destructiveByUser.set(args.userId, ds);
  }
  return { allowed: true };
}

export function _resetLimitsForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[globalKey];
}
