import type { ConnectionRecord, ConnectionStatus, TechId } from "./types";

type AnyRecord = ConnectionRecord<unknown>;

const globalKey = Symbol.for("baklava.connectionStore");

interface Store {
  byId: Map<string, AnyRecord>;
}

function getStore(): Store {
  const g = globalThis as unknown as Record<symbol, Store>;
  if (!g[globalKey]) {
    g[globalKey] = { byId: new Map() };
  }
  return g[globalKey];
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function listConnections(tech?: TechId): AnyRecord[] {
  const all = Array.from(getStore().byId.values());
  return tech ? all.filter((c) => c.tech === tech) : all;
}

export function getConnection(id: string): AnyRecord | undefined {
  return getStore().byId.get(id);
}

export function saveConnection<C>(input: {
  tech: TechId;
  name: string;
  config: C;
  status: ConnectionStatus;
  lastError?: string;
}): ConnectionRecord<C> {
  const record: ConnectionRecord<C> = {
    id: genId(),
    tech: input.tech,
    name: input.name,
    config: input.config,
    status: input.status,
    lastError: input.lastError,
    createdAt: Date.now(),
    lastTestedAt: input.status === "untested" ? undefined : Date.now(),
  };
  getStore().byId.set(record.id, record as AnyRecord);
  return record;
}

export function updateStatus(
  id: string,
  status: ConnectionStatus,
  lastError?: string
): AnyRecord | undefined {
  const existing = getStore().byId.get(id);
  if (!existing) return undefined;
  const updated: AnyRecord = {
    ...existing,
    status,
    lastError,
    lastTestedAt: Date.now(),
  };
  getStore().byId.set(id, updated);
  return updated;
}

export function deleteConnection(id: string): boolean {
  return getStore().byId.delete(id);
}

export function redactConfig<C extends Record<string, unknown>>(config: C): C {
  const cloned: Record<string, unknown> = { ...config };
  if (typeof cloned.password === "string" && cloned.password.length > 0) {
    cloned.password = "•".repeat(Math.min(cloned.password.length, 8));
  }
  if (cloned.sasl && typeof cloned.sasl === "object") {
    const sasl = { ...(cloned.sasl as Record<string, unknown>) };
    if (typeof sasl.password === "string" && sasl.password.length > 0) {
      sasl.password = "•".repeat(Math.min(sasl.password.length, 8));
    }
    cloned.sasl = sasl;
  }
  return cloned as C;
}

export function publicView(record: AnyRecord) {
  return {
    ...record,
    config: redactConfig(record.config as Record<string, unknown>),
  };
}
