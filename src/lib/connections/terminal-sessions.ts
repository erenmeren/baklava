import "server-only";
import type { Duplex } from "node:stream";

interface ExecLike {
  resize: (opts: { h: number; w: number }) => Promise<unknown>;
  inspect: () => Promise<{ ExitCode?: number | null }>;
}

export interface TerminalSession {
  id: string;
  connectionId: string;
  containerId: string;
  exec: ExecLike;
  stream: Duplex;
  // Pre-buffered output for clients that haven't connected yet (or reconnect).
  buffer: Buffer[];
  bufferBytes: number;
  closed: boolean;
  listeners: Set<(chunk: Buffer) => void>;
  closeListeners: Set<(reason: { code?: number | null }) => void>;
}

const MAX_BUFFER_BYTES = 256 * 1024;

const globalKey = Symbol.for("baklava.terminalSessions");

function getStore(): Map<string, TerminalSession> {
  const g = globalThis as unknown as Record<symbol, Map<string, TerminalSession>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function registerSession(
  init: Omit<
    TerminalSession,
    | "id"
    | "buffer"
    | "bufferBytes"
    | "closed"
    | "listeners"
    | "closeListeners"
  >
): TerminalSession {
  const session: TerminalSession = {
    ...init,
    id: genId(),
    buffer: [],
    bufferBytes: 0,
    closed: false,
    listeners: new Set(),
    closeListeners: new Set(),
  };

  session.stream.on("data", (chunk: Buffer | string) => {
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

  const onClose = async () => {
    if (session.closed) return;
    session.closed = true;
    let code: number | null | undefined = undefined;
    try {
      const inspect = await session.exec.inspect();
      code = inspect.ExitCode;
    } catch {
      // ignore
    }
    for (const fn of session.closeListeners) fn({ code });
    getStore().delete(session.id);
  };

  session.stream.once("end", onClose);
  session.stream.once("close", onClose);
  session.stream.once("error", onClose);

  getStore().set(session.id, session);
  return session;
}

export function getSession(id: string): TerminalSession | undefined {
  return getStore().get(id);
}

export function dropSession(id: string): void {
  const s = getStore().get(id);
  if (!s) return;
  try {
    s.stream.end();
  } catch {
    // ignore
  }
  getStore().delete(id);
}

export function dropConnectionSessions(connectionId: string): number {
  const store = getStore();
  let dropped = 0;
  for (const [id, s] of store) {
    if (s.connectionId !== connectionId) continue;
    try {
      s.stream.end();
    } catch {
      // ignore
    }
    store.delete(id);
    dropped += 1;
  }
  return dropped;
}
