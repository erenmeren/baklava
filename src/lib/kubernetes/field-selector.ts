/**
 * Field selectors are comma-separated `key=value` terms, so an unvalidated
 * name could append terms of its own and widen what the query matches. Names
 * and kinds are constrained to what Kubernetes itself permits.
 */

// DNS subdomain-ish: what object names are actually made of, plus the dots and
// underscores some generated names carry.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KIND = /^[A-Za-z]+$/;

export function involvedObjectSelector(kind: string, name: string): string {
  if (!KIND.test(kind)) throw new Error(`Invalid kind: ${kind}`);
  if (!NAME.test(name)) throw new Error(`Invalid name: ${name}`);
  return `involvedObject.kind=${kind},involvedObject.name=${name}`;
}
