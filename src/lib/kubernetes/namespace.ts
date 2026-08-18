/**
 * Namespace scoping for the Kubernetes workspace.
 *
 * The selected namespace travels in the URL (`?ns=`) so the *server* can
 * scope its list calls to it — a kubeconfig that is only allowed to read one
 * namespace 403s on the cluster-wide list endpoints, so scoping has to happen
 * before the request, not by filtering rows afterwards.
 */

/** Sentinel for "every namespace" — matches the k9s `-A` idea. */
export const ALL_NAMESPACES = "*";

/**
 * Resolve the namespace a page should list, from the `?ns=` search param and
 * the connection's configured default. The param wins (so the user can widen
 * a configured namespace back to `*`), then the config, then all namespaces.
 */
export function resolveNamespace(
  param: string | string[] | undefined,
  configured: string | undefined,
): string {
  const fromUrl = (Array.isArray(param) ? param[0] : param)?.trim();
  if (fromUrl) return fromUrl;
  const fromConfig = configured?.trim();
  if (fromConfig) return fromConfig;
  return ALL_NAMESPACES;
}
