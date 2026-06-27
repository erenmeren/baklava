import "server-only";
import os from "node:os";
import path from "node:path";
import { redactConfig } from "@/lib/connections/store";
import { readSecretFileSync, writeSecretFileSync } from "@/lib/crypto/secret-file";

export type ProviderId = "anthropic" | "openai" | "google";

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export interface AiSettings {
  activeProvider: ProviderId | null;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  stepCap: number;
  /** User-chosen display name for the assistant. Empty = use the default. */
  agentName: string;
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4.1",
  google: "gemini-2.5-pro",
};

function dataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function file(): string {
  return path.join(dataDir(), "ai.json");
}

function emptySettings(): AiSettings {
  return { activeProvider: null, providers: {}, stepCap: 12, agentName: "" };
}

const globalKey = Symbol.for("baklava.aiSettings");

function loadFromDisk(): AiSettings {
  try {
    const text = readSecretFileSync(file());
    if (text == null) return emptySettings();
    const raw = JSON.parse(text) as Partial<AiSettings>;
    return {
      activeProvider: raw.activeProvider ?? null,
      providers: raw.providers ?? {},
      stepCap: typeof raw.stepCap === "number" ? raw.stepCap : 12,
      agentName: typeof raw.agentName === "string" ? raw.agentName : "",
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[baklava] could not read ${file()}:`, err);
    }
    return emptySettings();
  }
}

function getStore(): { settings: AiSettings } {
  const g = globalThis as unknown as Record<symbol, { settings: AiSettings }>;
  if (!g[globalKey]) g[globalKey] = { settings: loadFromDisk() };
  return g[globalKey];
}

function persist(): void {
  try {
    writeSecretFileSync(file(), JSON.stringify(getStore().settings, null, 2));
  } catch (err) {
    console.error(`[baklava] could not persist ${file()}:`, err);
  }
}

export function getSettings(): AiSettings {
  return getStore().settings;
}

export function saveProvider(id: ProviderId, cfg: ProviderConfig): void {
  const existing = getStore().settings.providers[id];
  const apiKey = cfg.apiKey?.trim() ? cfg.apiKey : existing?.apiKey ?? "";
  getStore().settings.providers[id] = { apiKey, model: cfg.model || DEFAULT_MODELS[id] };
  persist();
}

export function setActiveProvider(id: ProviderId | null): void {
  getStore().settings.activeProvider = id;
  persist();
}

export function setStepCap(n: number): void {
  getStore().settings.stepCap = Math.min(Math.max(Math.floor(n), 1), 50);
  persist();
}

export function setAgentName(name: string): void {
  // Collapse whitespace (incl. newlines) and cap, so a name can't smuggle
  // extra lines into the system prompt or bloat it.
  getStore().settings.agentName = name.replace(/\s+/g, " ").trim().slice(0, 60);
  persist();
}

export function publicSettings(): AiSettings {
  return redactConfig(getStore().settings as unknown as Record<string, unknown>) as unknown as AiSettings;
}
