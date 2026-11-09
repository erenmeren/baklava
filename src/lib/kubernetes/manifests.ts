import { parseAllDocuments, stringify } from "yaml";
import { unifiedDiff } from "./line-diff";

/** Caps on what one apply request may carry. */
export const MAX_MANIFEST_BYTES = 512 * 1024;
export const MAX_MANIFEST_DOCS = 50;

/** A user-input problem with the submitted YAML — the route answers 400. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export interface Manifest {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * Split a multi-document (`---`) YAML string into Kubernetes objects and
 * validate the shape server-side apply needs. Empty documents are skipped.
 */
export function parseManifests(text: string): Manifest[] {
  if (new TextEncoder().encode(text).length > MAX_MANIFEST_BYTES) {
    throw new ManifestError(`YAML is larger than ${MAX_MANIFEST_BYTES / 1024} KiB`);
  }
  const docs = parseAllDocuments(text);
  if (!Array.isArray(docs)) throw new ManifestError("Could not parse YAML");
  const out: Manifest[] = [];
  docs.forEach((doc, idx) => {
    const n = idx + 1;
    if (doc.errors.length) {
      throw new ManifestError(`document ${n}: ${doc.errors[0].message}`);
    }
    const obj = doc.toJS() as unknown;
    if (obj === null || obj === undefined) return;
    if (typeof obj !== "object" || Array.isArray(obj)) {
      throw new ManifestError(`document ${n}: expected a mapping`);
    }
    const m = obj as Record<string, unknown>;
    if (typeof m.apiVersion !== "string" || !m.apiVersion) {
      throw new ManifestError(`document ${n}: missing apiVersion`);
    }
    if (typeof m.kind !== "string" || !m.kind) {
      throw new ManifestError(`document ${n}: missing kind`);
    }
    if (m.kind.endsWith("List")) {
      throw new ManifestError(`document ${n}: ${m.kind} is not supported — split it into separate documents`);
    }
    const meta = m.metadata as Record<string, unknown> | undefined;
    if (!meta || typeof meta !== "object" || typeof meta.name !== "string" || !meta.name) {
      // Server-side apply needs a name; generateName only works with create.
      throw new ManifestError(`document ${n} (${m.kind}): missing metadata.name`);
    }
    if (meta.namespace !== undefined && typeof meta.namespace !== "string") {
      throw new ManifestError(`document ${n} (${m.kind}): metadata.namespace must be a string`);
    }
    // Applying a values-less Secret drops every key this field manager owns —
    // and a redacted view (k8s_get_yaml / the read-only YAML tab) has exactly
    // that shape. Refuse it rather than wipe the Secret.
    if (m.kind === "Secret" && !hasKeys(m.data) && !hasKeys(m.stringData)) {
      throw new ManifestError(
        `document ${n} (Secret ${meta.name}): no data/stringData — refusing, this looks like a redacted view and applying it could erase the Secret's values`,
      );
    }
    out.push(m as Manifest);
  });
  if (out.length === 0) throw new ManifestError("No Kubernetes objects in the YAML");
  if (out.length > MAX_MANIFEST_DOCS) {
    throw new ManifestError(`Too many documents (${out.length}); the limit is ${MAX_MANIFEST_DOCS}`);
  }
  return out;
}

function hasKeys(v: unknown): boolean {
  return !!v && typeof v === "object" && Object.keys(v).length > 0;
}

/** Drop server-managed noise so a diff shows only what the user controls. */
export function stripNoise(obj: unknown): Record<string, unknown> {
  const o = JSON.parse(JSON.stringify(obj ?? {})) as Record<string, unknown>;
  const meta = o.metadata as Record<string, unknown> | undefined;
  if (meta) {
    for (const k of ["managedFields", "resourceVersion", "uid", "generation", "creationTimestamp", "selfLink"]) {
      delete meta[k];
    }
    const ann = meta.annotations as Record<string, unknown> | undefined;
    if (ann) {
      // Mirrors the whole manifest (a Secret's values included).
      delete ann["kubectl.kubernetes.io/last-applied-configuration"];
      if (Object.keys(ann).length === 0) delete meta.annotations;
    }
  }
  delete o.status;
  return o;
}

const HIDDEN = "(hidden)";
const CHANGED = "(hidden, changed)";

/**
 * Replace a Secret's values on both sides with placeholders so the diff shows
 * which keys were added, removed or changed — never the values themselves.
 */
function redactSecretPair(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): void {
  for (const field of ["data", "stringData"]) {
    const b = (before?.[field] ?? undefined) as Record<string, unknown> | undefined;
    const a = after[field] as Record<string, unknown> | undefined;
    if (a) {
      for (const k of Object.keys(a)) {
        a[k] = b && k in b && b[k] !== a[k] ? CHANGED : HIDDEN;
      }
    }
    if (b) for (const k of Object.keys(b)) b[k] = HIDDEN;
  }
}

export type ChangeAction = "created" | "configured" | "unchanged";

/**
 * Compare the live object (null when it doesn't exist yet) with the
 * server-side apply result: what kind of change it is, plus a unified diff
 * of the noise-stripped YAML. Secret values never reach the diff.
 */
export function describeChange(
  live: unknown | null,
  result: unknown,
): { action: ChangeAction; diff: string } {
  const before = live == null ? null : stripNoise(live);
  const after = stripNoise(result);
  if (after.kind === "Secret") redactSecretPair(before, after);
  const beforeText = before ? stringify(before) : "";
  const afterText = stringify(after);
  const diff = unifiedDiff(beforeText, afterText);
  return {
    action: before === null ? "created" : diff ? "configured" : "unchanged",
    diff,
  };
}
