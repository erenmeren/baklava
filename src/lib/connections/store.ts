import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConnectionRecord, ConnectionStatus, TechId } from "./types";

type AnyRecord = ConnectionRecord<unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Disk persistence
//
// Connections survive Next.js restarts by being mirrored to a JSON file under
// the user's home directory. We persist on user-initiated mutations only
// (saveConnection, deleteConnection) — NOT on every updateStatus, because
// status flips on every API request and would thrash the disk.
//
// Override the location with the BAKLAVA_DATA_DIR env var.
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR =
  process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
const FILE = path.join(DATA_DIR, "connections.json");

interface PersistedShape {
  version: 1;
  connections: AnyRecord[];
}

function loadFromDisk(): AnyRecord[] {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const data = JSON.parse(raw) as Partial<PersistedShape>;
    // Accept either the current { version: 1, connections } shape or a legacy
    // { connections: [...] } shape (no version) from earlier experiments.
    if (Array.isArray(data?.connections)) {
      return data.connections as AnyRecord[];
    }
    console.warn(
      `[baklava] ${FILE} has unexpected shape, ignoring (starting empty)`
    );
    return [];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`[baklava] could not read ${FILE}:`, err);
    }
    return [];
  }
}

function persistToDisk(records: AnyRecord[]): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const payload: PersistedShape = { version: 1, connections: records };
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (err) {
    // Logging only — don't fail the mutation just because we couldn't write.
    console.error(`[baklava] could not persist ${FILE}:`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store (globalThis-scoped so it survives Next dev HMR)
// ─────────────────────────────────────────────────────────────────────────────

const globalKey = Symbol.for("baklava.connectionStore");

interface Store {
  byId: Map<string, AnyRecord>;
}

function getStore(): Store {
  const g = globalThis as unknown as Record<symbol, Store>;
  if (!g[globalKey]) {
    const byId = new Map<string, AnyRecord>();
    for (const rec of loadFromDisk()) {
      if (rec?.id) byId.set(rec.id, rec);
    }
    g[globalKey] = { byId };
  }
  return g[globalKey];
}

function flush(): void {
  persistToDisk([...getStore().byId.values()]);
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
  flush();
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
  // Intentionally NOT calling flush() here — status updates fire on every API
  // request and would thrash the disk. Status is recomputed on next probe.
  return updated;
}

export function deleteConnection(id: string): boolean {
  const deleted = getStore().byId.delete(id);
  if (deleted) flush();
  return deleted;
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
