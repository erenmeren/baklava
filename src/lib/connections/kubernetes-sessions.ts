import "server-only";
import type { Duplex, PassThrough } from "node:stream";
import type WebSocket from "isomorphic-ws";

export interface K8sExecSession {
  id: string;
  connectionId: string;
  namespace: string;
  podName: string;
  stdin: PassThrough;
  output: Duplex;
  ws: WebSocket;
  close: () => void;
  buffer: Buffer[];
  bufferBytes: number;
  closed: boolean;
  listeners: Set<(chunk: Buffer) => void>;
  closeListeners: Set<() => void>;
}

const MAX_BUFFER_BYTES = 256 * 1024;
const globalKey = Symbol.for("baklava.kubernetesExecSessions");

function getStore(): Map<string, K8sExecSession> {
  const g = globalThis as unknown as Record<symbol, Map<string, K8sExecSession>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

interface RegisterArgs {
  connectionId: string;
  namespace: string;
  podName: string;
  stdin: PassThrough;
  output: Duplex;
  ws: WebSocket;
  close: () => void;
}

export function registerExecSession(args: RegisterArgs): K8sExecSession {
  const session: K8sExecSession = {
    ...args,
    id: genId(),
    buffer: [],
    bufferBytes: 0,
    closed: false,
    listeners: new Set(),
    closeListeners: new Set(),
  };

  session.output.on("data", (chunk: Buffer | string) => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (session.listeners.size > 0) {
      for (const fn of session.listeners) fn(buf);
    } else {
      session.buffer.push(buf);
      session.bufferBytes += buf.length;
      while (session.bufferBytes > MAX_BUFFER_BYTES && session.buffer.length) {
        const dropped = session.buffer.shift();
        if (dropped) session.bufferBytes -= dropped.length;
      }
    }
  });

  const onClose = () => {
    if (session.closed) return;
    session.closed = true;
    for (const fn of session.closeListeners) fn();
    getStore().delete(session.id);
  };
  session.output.once("end", onClose);
  session.output.once("close", onClose);
  session.output.once("error", onClose);

  getStore().set(session.id, session);
  return session;
}

export function getExecSession(id: string): K8sExecSession | undefined {
  return getStore().get(id);
}

export function dropExecSession(id: string): void {
  const s = getStore().get(id);
  if (!s) return;
  try {
    s.close();
  } catch {
    // ignore
  }
  getStore().delete(id);
}

export function dropConnectionExecSessions(connectionId: string): number {
  const store = getStore();
  let dropped = 0;
  for (const [id, s] of store) {
    if (s.connectionId !== connectionId) continue;
    try {
      s.close();
    } catch {
      // ignore
    }
    store.delete(id);
    dropped += 1;
  }
  return dropped;
}
