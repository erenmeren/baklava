import "server-only";
import { techMetaById } from "@/techs/meta-registry";

/** Packages to install for a tech — derived from the registry, NEVER from client
 *  input. Throws for an unknown tech or one with no installable driver. */
export function resolveInstallPackages(techId: string): string[] {
  const meta = techMetaById.get(techId);
  if (!meta) throw new Error(`Unknown tech: ${techId}`);
  if (!meta.optionalDeps.length) {
    throw new Error(`Tech "${techId}" has no installable driver packages`);
  }
  return [...meta.optionalDeps];
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Strip port / IPv6 brackets from a Host header → bare lowercase hostname. */
function hostnameOf(hostHeader: string | null): string {
  if (!hostHeader) return "";
  const h = hostHeader.trim();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]")).toLowerCase(); // [::1]:3000
  return h.split(":")[0].toLowerCase();
}

/** Install is allowed only for local requests, and only when not disabled by env. */
export function isInstallAllowed(hostHeader: string | null): boolean {
  if (process.env.BAKLAVA_DISABLE_DRIVER_INSTALL) return false;
  const h = hostnameOf(hostHeader);
  return LOCAL_HOSTS.has(h) || h.endsWith(".localhost");
}
