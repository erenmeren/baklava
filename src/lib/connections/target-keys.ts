/**
 * Config keys that decide *where* a connection's stored credentials are sent,
 * or how well they're protected on the way (TLS). PATCH keeps a stored secret
 * when the field is left blank, so a `write` grantee who could change these
 * could point the owner's saved password at a server they control and read it
 * off the next probe. Only the owner or an admin may change them.
 */
const TARGET_KEYS = new Set([
  // where
  "host", "port", "nodes", "brokers", "uri", "url", "endpoint", "accountId", "region",
  "schemaRegistryUrl", "mode", "socketPath", "protocol",
  "source", "kubeconfigPath", "kubeconfigYaml", "context",
  // how safely
  "ssl", "tls", "encrypt", "trustServerCertificate", "useSSL",
]);

// Edit forms resend the whole config, so an absent optional field may come
// back as `false` or `""`. Those mean the same thing ("off" / "not set").
function norm(v: unknown): string {
  return v === undefined || v === null || v === "" || v === false ? "" : JSON.stringify(v);
}

/** Target keys a PATCH would change (set to a different value, or unset). */
export function changedTargetKeys(
  existing: Record<string, unknown>,
  patch: { config?: Record<string, unknown>; unset?: string[] },
): string[] {
  const changed = new Set<string>();
  for (const [key, value] of Object.entries(patch.config ?? {})) {
    if (TARGET_KEYS.has(key) && norm(value) !== norm(existing[key])) changed.add(key);
  }
  for (const key of patch.unset ?? []) {
    if (TARGET_KEYS.has(key) && norm(existing[key]) !== "") changed.add(key);
  }
  return [...changed];
}
