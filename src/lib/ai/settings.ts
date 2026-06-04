import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactConfig } from "@/lib/connections/store";

export type ProviderId = "anthropic" | "openai" | "google";

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export interface AiSettings {
  activeProvider: ProviderId | null;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  stepCap: number;
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
  return { activeProvider: null, providers: {}, stepCap: 12 };
}

const globalKey = Symbol.for("baklava.aiSettings");

function loadFromDisk(): AiSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<AiSettings>;
    return {
      activeProvider: raw.activeProvider ?? null,
      providers: raw.providers ?? {},
      stepCap: typeof raw.stepCap === "number" ? raw.stepCap : 12,
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
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(getStore().settings, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file());
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

export function publicSettings(): AiSettings {
  return redactConfig(getStore().settings as unknown as Record<string, unknown>) as unknown as AiSettings;
}
