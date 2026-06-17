import { createRequire } from "node:module";
import type { TechModule } from "./contract";

const require = createRequire(import.meta.url);
const cache = new Map<string, boolean>();

/** True if `pkg` can be resolved from this process. Cached per package. */
export function isDriverInstalled(pkg: string): boolean {
  const hit = cache.get(pkg);
  if (hit !== undefined) return hit;
  let installed = false;
  try {
    require.resolve(pkg);
    installed = true;
  } catch {
    installed = false;
  }
  cache.set(pkg, installed);
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
