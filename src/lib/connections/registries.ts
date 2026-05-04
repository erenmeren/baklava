import "server-only";

export interface RegistryCred {
  id: string;
  name: string;
  serverAddress: string; // e.g. "https://index.docker.io/v1/" or "ghcr.io"
  username: string;
  password: string; // plaintext in memory only
  email?: string;
  createdAt: number;
}

const globalKey = Symbol.for("baklava.registries");

interface Store {
  byConnection: Map<string, RegistryCred[]>;
}

function getStore(): Store {
  const g = globalThis as unknown as Record<symbol, Store>;
  if (!g[globalKey]) g[globalKey] = { byConnection: new Map() };
  return g[globalKey];
}

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function listRegistries(connectionId: string): RegistryCred[] {
  return getStore().byConnection.get(connectionId) ?? [];
}

export function addRegistry(
  connectionId: string,
  input: Omit<RegistryCred, "id" | "createdAt">
): RegistryCred {
  const record: RegistryCred = {
    ...input,
    id: genId(),
    createdAt: Date.now(),
  };
  const list = getStore().byConnection.get(connectionId) ?? [];
  list.push(record);
  getStore().byConnection.set(connectionId, list);
  return record;
}

export function removeRegistry(connectionId: string, id: string): boolean {
  const list = getStore().byConnection.get(connectionId);
  if (!list) return false;
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return false;
  getStore().byConnection.set(connectionId, next);
  return true;
}

// Match a credential to a docker image reference like
//   "postgres:16"                        → docker.io
//   "ghcr.io/owner/repo:tag"             → ghcr.io
//   "registry.example.com:5000/foo:tag"  → registry.example.com:5000
function refRegistryHost(ref: string): string {
  const slashIdx = ref.indexOf("/");
  if (slashIdx < 0) return "docker.io";
  const head = ref.slice(0, slashIdx);
  if (head === "library" || (!head.includes(".") && !head.includes(":"))) {
    return "docker.io";
  }
  return head;
}

function normalizeAddress(address: string): string {
  return address
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function findCredForRef(
  connectionId: string,
  ref: string
): RegistryCred | undefined {
  const host = refRegistryHost(ref).toLowerCase();
  const creds = listRegistries(connectionId);
  // Special case: docker.io ↔ index.docker.io
  for (const c of creds) {
    const norm = normalizeAddress(c.serverAddress);
    if (norm === host) return c;
    if (
      (host === "docker.io" || host === "index.docker.io") &&
      (norm === "docker.io" ||
        norm === "index.docker.io" ||
        norm === "registry-1.docker.io")
    ) {
      return c;
    }
  }
  return undefined;
}

export function publicRegistry(r: RegistryCred): Omit<RegistryCred, "password"> {
  // never leak the password back over HTTP
  const { password: _password, ...rest } = r;
  void _password;
  return rest;
}
