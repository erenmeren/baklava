import type { Plugin } from "./sources/types.js";
import { sqlitePlugin } from "./sources/sqlite.js";
import { postgresPlugin } from "./sources/postgres.js";
import { BaklavaException, makeError } from "./errors.js";

const REGISTRY = new Map<string, Plugin<unknown>>([
  ["sqlite", sqlitePlugin as Plugin<unknown>],
  ["postgres", postgresPlugin as Plugin<unknown>],
]);

export function getPlugin(name: string): Plugin<unknown> {
  const p = REGISTRY.get(name);
  if (!p) {
    throw new BaklavaException(
      makeError({
        code: "E_CONNECTION_NOT_FOUND",
        what: `Unknown plugin "${name}".`,
        why: `Available plugins: ${[...REGISTRY.keys()].join(", ")}.`,
        fix: "Fix the plugin field in your connection config, or install a plugin that provides this name.",
      })
    );
  }
  return p;
}

export function listPlugins(): string[] {
  return [...REGISTRY.keys()];
}
