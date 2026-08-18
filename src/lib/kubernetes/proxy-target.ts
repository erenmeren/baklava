/**
 * Addressing for the API server's pod proxy subresource
 * (`/api/v1/namespaces/<ns>/pods/<name>:<port>/proxy/<path>`).
 *
 * Both the pod name and the path land inside a URL the API server builds, so
 * everything is validated here rather than trusted: a name or path that can
 * carry `/` or `..` could address a different subresource entirely.
 */

// DNS subdomain, which is what a pod name is.
const NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
// A named port is a DNS label (`http`, `metrics`), max 15 chars per the spec.
const NAMED_PORT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export interface ProxyTarget {
  /** `<pod>:<port>`, the form the proxy subresource takes. */
  name: string;
  /** Sub-path inside the pod, always rooted. */
  path: string;
}

export function proxyTarget(
  pod: string,
  port: number | string,
  path: string,
): ProxyTarget {
  if (!NAME.test(pod)) throw new Error(`Invalid pod name: ${pod}`);

  const raw = String(port).trim();
  if (!raw) throw new Error("Port is required");
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n < 1 || n > 65535) throw new Error(`Invalid port: ${raw}`);
  } else if (!NAMED_PORT.test(raw) || raw.length > 15) {
    throw new Error(`Invalid port: ${raw}`);
  }

  let p = path.trim();
  if (!p) p = "/";
  // A protocol-relative or absolute URL would point the proxy somewhere else.
  if (p.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(p)) {
    throw new Error(`Invalid path: ${path}`);
  }
  if (!p.startsWith("/")) p = `/${p}`;
  // `..` would climb out of the proxy subresource into the rest of the API.
  if (p.split(/[/?]/).includes("..")) throw new Error(`Invalid path: ${path}`);

  return { name: `${pod}:${raw}`, path: p };
}
