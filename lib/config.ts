import { homedir } from "node:os";
import { join } from "node:path";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { BaklavaException, makeError } from "./errors.js";

export const CURRENT_SCHEMA_VERSION = 1;

export function baklavaDir(): string {
  return process.env.BAKLAVA_HOME ?? join(homedir(), ".baklava");
}
export function connectionsPath(): string {
  return join(baklavaDir(), "connections.json");
}
export function configPath(): string {
  return join(baklavaDir(), "config.json");
}
export function instanceKeyPath(): string {
  return join(baklavaDir(), "instance.key");
}

// Eager constants kept for back-compat; prefer the functions above in tests.
export const BAKLAVA_DIR = baklavaDir();
export const CONNECTIONS_PATH = connectionsPath();
export const CONFIG_PATH = configPath();
export const INSTANCE_KEY_PATH = instanceKeyPath();

const SAFE_MODE_MASK = 0o077;

export interface ConnectionsFile {
  schema_version: number;
  connections: ConnectionConfig[];
}

export interface ConnectionConfig {
  name: string;
  plugin: string;
  config: Record<string, unknown>;
}

export interface ConfigFile {
  schema_version: number;
  anthropic_api_key?: string;
}

function ensureBaklavaDir(): void {
  const dir = baklavaDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function assertSafePermissions(path: string): void {
  if (process.platform === "win32") return;
  const mode = statSync(path).mode & 0o777;
  if (mode & SAFE_MODE_MASK) {
    throw new BaklavaException(
      makeError({
        code: "E_CONFIG_PERMISSIONS",
        what: `${path} has unsafe permissions (${mode.toString(8)}).`,
        why: "Files containing credentials must not be readable or writable by group or other users. baklava refuses to load them.",
        fix: `Run: chmod 600 ${path}`,
        raw: { path, mode: mode.toString(8) },
      })
    );
  }
}

function writeSecure(path: string, contents: string): void {
  ensureBaklavaDir();
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

function parseSchemaVersion<T extends { schema_version?: unknown }>(
  parsed: T,
  path: string
): asserts parsed is T & { schema_version: number } {
  if (typeof parsed.schema_version !== "number") {
    throw new BaklavaException(
      makeError({
        code: "E_CONFIG_CORRUPT",
        what: `${path} is missing the schema_version field.`,
        why: "All baklava config files carry a schema_version so the migrator can apply forward-compatible changes.",
        fix: `Open ${path} and add "schema_version": ${CURRENT_SCHEMA_VERSION} as the top-level field, or delete the file to regenerate it.`,
        raw: { path },
      })
    );
  }
  if (parsed.schema_version > CURRENT_SCHEMA_VERSION) {
    throw new BaklavaException(
      makeError({
        code: "E_CONFIG_VERSION_UNSUPPORTED",
        what: `${path} declares schema_version ${parsed.schema_version}, but this baklava only supports up to ${CURRENT_SCHEMA_VERSION}.`,
        why: "The file was written by a newer baklava. Loading it could lose fields the current version does not understand.",
        fix: "Upgrade baklava: npm i -g baklava@latest",
        raw: { path, declared: parsed.schema_version, supported: CURRENT_SCHEMA_VERSION },
      })
    );
  }
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return null;
  assertSafePermissions(path);
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new BaklavaException(
      makeError({
        code: "E_CONFIG_CORRUPT",
        what: `${path} is not valid JSON.`,
        why: "The file may have been hand-edited and a syntax error was introduced.",
        fix: `Open ${path} and fix the JSON, or delete the file to let baklava regenerate it.`,
        raw: { path, parseError: String(err) },
      })
    );
  }
}

export function loadConnections(): ConnectionsFile {
  const path = connectionsPath();
  const parsed = readJsonFile(path);
  if (parsed === null) {
    return { schema_version: CURRENT_SCHEMA_VERSION, connections: [] };
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BaklavaException(
      makeError({
        code: "E_CONFIG_CORRUPT",
        what: `${path} is not an object.`,
        why: "baklava expects a JSON object with schema_version and connections fields.",
        fix: `Delete ${path} to regenerate it, or fix the contents by hand.`,
      })
    );
  }
  parseSchemaVersion(parsed as { schema_version?: unknown }, path);
  const file = parsed as ConnectionsFile;
  if (!Array.isArray(file.connections)) file.connections = [];
  return file;
}

export function saveConnections(file: ConnectionsFile): void {
  writeSecure(connectionsPath(), JSON.stringify(file, null, 2));
}

export function loadConfig(): ConfigFile {
  const path = configPath();
  const parsed = readJsonFile(path);
  if (parsed === null) {
    return { schema_version: CURRENT_SCHEMA_VERSION };
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BaklavaException(
      makeError({
        code: "E_CONFIG_CORRUPT",
        what: `${path} is not an object.`,
        why: "baklava expects a JSON object.",
        fix: `Delete ${path} to regenerate it.`,
      })
    );
  }
  parseSchemaVersion(parsed as { schema_version?: unknown }, path);
  return parsed as ConfigFile;
}

export function saveConfig(file: ConfigFile): void {
  writeSecure(configPath(), JSON.stringify(file, null, 2));
}

export function getAnthropicApiKey(): string | null {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const config = loadConfig();
  const fromFile = config.anthropic_api_key?.trim();
  return fromFile || null;
}
