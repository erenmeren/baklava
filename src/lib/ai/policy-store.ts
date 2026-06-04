import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_POLICY, type PermissionPolicy } from "./permissions";

function dataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function file(): string {
  return path.join(dataDir(), "ai-policies.json");
}

const globalKey = Symbol.for("baklava.aiPolicies");

function loadFromDisk(): Record<string, PermissionPolicy> {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as Record<string, PermissionPolicy>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[baklava] could not read ${file()}:`, err);
    }
    return {};
  }
}

function getStore(): { byId: Record<string, PermissionPolicy> } {
  const g = globalThis as unknown as Record<symbol, { byId: Record<string, PermissionPolicy> }>;
  if (!g[globalKey]) g[globalKey] = { byId: loadFromDisk() };
  return g[globalKey];
}

function persist(): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(getStore().byId, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error(`[baklava] could not persist ${file()}:`, err);
  }
}

export function getPolicy(connectionId: string): PermissionPolicy {
  return getStore().byId[connectionId] ?? { ...DEFAULT_POLICY };
}

export function setPolicy(connectionId: string, policy: PermissionPolicy): void {
  getStore().byId[connectionId] = policy;
  persist();
}

export function deletePolicy(connectionId: string): void {
  if (getStore().byId[connectionId]) {
    delete getStore().byId[connectionId];
    persist();
  }
}
