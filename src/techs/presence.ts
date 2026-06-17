import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TechModule } from "./contract";

// Shared on globalThis so the positive cache is one instance across server
// components and route handlers (Turbopack may otherwise load this module twice).
const cache: Map<string, boolean> = ((
  globalThis as Record<symbol, unknown>
)[Symbol.for("baklava.driverPresence")] ??= new Map<string, boolean>()) as Map<
  string,
  boolean
>;

/** True if the package is installed in the project's node_modules.
 *
 * We check `node_modules/<pkg>/package.json` on disk rather than
 * `require.resolve`: in a long-running Next/Turbopack server process,
 * require.resolve does NOT pick up a package installed AFTER the process
 * started, so a tile would never re-enable after an in-app install. A direct
 * fs stat always reflects current disk state.
 *
 * Only POSITIVE results are cached — a missing package is volatile (the user may
 * install it at runtime), so negatives are always re-checked. */
export function isDriverInstalled(pkg: string): boolean {
  if (cache.get(pkg)) return true;
  // pkg may be scoped ("@aws-sdk/client-s3") — split so the path is correct.
  const installed = existsSync(
    join(process.cwd(), "node_modules", ...pkg.split("/"), "package.json"),
  );
  if (installed) cache.set(pkg, true);
  return installed;
}

/** True only if every optional dependency the module declares is resolvable. */
export function modulesInstalled(module: TechModule): boolean {
  return module.optionalDeps.every(isDriverInstalled);
}

/** Drop cached resolution results so the next isDriverInstalled re-checks disk.
 *  Call after installing a driver at runtime. Omit `pkgs` to clear everything. */
export function invalidatePresence(pkgs?: string[]): void {
  if (!pkgs) {
    cache.clear();
    return;
  }
  for (const p of pkgs) cache.delete(p);
}
