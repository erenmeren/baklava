import "server-only";

type Resolver = (approved: boolean) => void;

const globalKey = Symbol.for("baklava.aiPending");

function store(): Map<string, Resolver> {
  const g = globalThis as unknown as Record<symbol, Map<string, Resolver>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function key(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

export function createPending(sessionId: string, toolCallId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    store().set(key(sessionId, toolCallId), resolve);
  });
}

export function resolvePending(sessionId: string, toolCallId: string, approved: boolean): boolean {
  const k = key(sessionId, toolCallId);
  const resolver = store().get(k);
  if (!resolver) return false;
  store().delete(k);
  resolver(approved);
  return true;
}
