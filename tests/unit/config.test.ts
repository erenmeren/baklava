import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURRENT_SCHEMA_VERSION,
  connectionsPath,
  configPath,
  loadConnections,
  saveConnections,
  loadConfig,
  saveConfig,
  getAnthropicApiKey,
} from "../../lib/config.js";

const ORIG_BAKLAVA_HOME = process.env.BAKLAVA_HOME;
const ORIG_KEY = process.env.ANTHROPIC_API_KEY;

let tmpHome = "";

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "baklava-test-"));
  process.env.BAKLAVA_HOME = tmpHome;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (ORIG_BAKLAVA_HOME === undefined) delete process.env.BAKLAVA_HOME;
  else process.env.BAKLAVA_HOME = ORIG_BAKLAVA_HOME;
  if (ORIG_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIG_KEY;
});

describe("loadConnections", () => {
  it("returns an empty file when no connections.json exists", () => {
    const file = loadConnections();
    expect(file.connections).toEqual([]);
    expect(file.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("round-trips a saved file", () => {
    const original = {
      schema_version: CURRENT_SCHEMA_VERSION,
      connections: [
        {
          name: "pg-local",
          plugin: "postgres",
          config: { host: "localhost", port: 5432 },
        },
      ],
    };
    saveConnections(original);
    const reloaded = loadConnections();
    expect(reloaded).toEqual(original);
  });

  it("rejects a JSON file with bad syntax", () => {
    writeFileSync(connectionsPath(), "{not valid json", { mode: 0o600 });
    expect(() => loadConnections()).toThrow(/E_CONFIG_CORRUPT|not valid JSON/i);
  });

  it("rejects a file missing schema_version", () => {
    writeFileSync(connectionsPath(), JSON.stringify({ connections: [] }), { mode: 0o600 });
    expect(() => loadConnections()).toThrow(/schema_version/i);
  });

  it("rejects a future schema_version it cannot understand", () => {
    writeFileSync(
      connectionsPath(),
      JSON.stringify({ schema_version: 9999, connections: [] }),
      { mode: 0o600 }
    );
    expect(() => loadConnections()).toThrow(/E_CONFIG_VERSION_UNSUPPORTED|9999/);
  });
});

describe("permissions enforcement (POSIX only)", () => {
  const skipOnWindows = process.platform === "win32" ? it.skip : it;

  skipOnWindows("saveConnections writes the file with mode 0600", () => {
    saveConnections({ schema_version: CURRENT_SCHEMA_VERSION, connections: [] });
    const mode = statSync(connectionsPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  skipOnWindows("refuses to load a world-readable connections file", () => {
    writeFileSync(
      connectionsPath(),
      JSON.stringify({ schema_version: CURRENT_SCHEMA_VERSION, connections: [] }),
      { mode: 0o644 }
    );
    chmodSync(connectionsPath(), 0o644);
    expect(() => loadConnections()).toThrow(/E_CONFIG_PERMISSIONS|chmod 600/);
  });

  skipOnWindows("refuses to load a group-readable config file", () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        schema_version: CURRENT_SCHEMA_VERSION,
        anthropic_api_key: "sk-ant-xxx",
      }),
      { mode: 0o640 }
    );
    chmodSync(configPath(), 0o640);
    expect(() => loadConfig()).toThrow(/E_CONFIG_PERMISSIONS|chmod 600/);
  });
});

describe("getAnthropicApiKey", () => {
  it("returns null when neither env nor file has a key", () => {
    expect(getAnthropicApiKey()).toBeNull();
  });

  it("returns the env key when set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    expect(getAnthropicApiKey()).toBe("sk-ant-from-env");
  });

  it("falls back to the config file when env is unset", () => {
    saveConfig({
      schema_version: CURRENT_SCHEMA_VERSION,
      anthropic_api_key: "sk-ant-from-file",
    });
    expect(getAnthropicApiKey()).toBe("sk-ant-from-file");
  });

  it("env takes precedence over file", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-wins";
    saveConfig({
      schema_version: CURRENT_SCHEMA_VERSION,
      anthropic_api_key: "sk-ant-from-file",
    });
    expect(getAnthropicApiKey()).toBe("sk-ant-env-wins");
  });
});
