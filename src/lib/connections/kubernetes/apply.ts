import "server-only";
import type { KubernetesObject, V1APIResource } from "@kubernetes/client-node";
import type { KubernetesConfig } from "../types";
import { bundleFor, getK8s } from "../kubernetes";
import { formatError } from "@/lib/errors";
import { describeChange, parseManifests, type ChangeAction } from "@/lib/kubernetes/manifests";

/** The field manager every Baklava apply runs under. */
export const FIELD_MANAGER = "baklava";

export interface ApplyConflict {
  field?: string;
  message: string;
}

export interface ApplyOutcome {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  action: ChangeAction | "conflict" | "error";
  /** Unified diff of live vs. result, Secret values replaced by placeholders. */
  diff?: string;
  conflicts?: ApplyConflict[];
  error?: string;
}

export interface ApplyOptions {
  /** Default namespace for namespaced objects that don't name one. */
  namespace?: string;
  dryRun: boolean;
  force?: boolean;
}

interface StatusBody {
  message?: string;
  details?: { causes?: { field?: string; message?: string }[] };
}

function errorBody(err: unknown): StatusBody | null {
  const body = (err as { body?: unknown }).body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as StatusBody;
    } catch {
      return { message: body };
    }
  }
  return body && typeof body === "object" ? (body as StatusBody) : null;
}

function errorCode(err: unknown): number | undefined {
  const c = (err as { code?: unknown }).code;
  return typeof c === "number" ? c : undefined;
}

/**
 * Server-side apply every document of a (multi-doc) YAML string, as
 * `kubectl apply --server-side --field-manager=baklava`. With `dryRun` the
 * API server runs admission and defaulting but persists nothing. Each object
 * reports created / configured / unchanged plus a diff against the live
 * object; a field-manager conflict (409) reports its fields instead, and
 * other per-object failures don't stop the rest — like kubectl.
 *
 * Throws `ManifestError` for malformed input (the caller answers 400).
 */
export async function applyManifests(
  connectionId: string,
  cfg: KubernetesConfig,
  yaml: string,
  opts: ApplyOptions,
): Promise<ApplyOutcome[]> {
  const docs = parseManifests(yaml);
  const { PatchStrategy } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  // `resource()` is protected in the typings but is the client's own cached
  // discovery lookup — the same one patch() uses to build the URL.
  const discover = (apiVersion: string, kind: string) =>
    (
      b.objects as unknown as {
        resource(a: string, k: string): Promise<V1APIResource | undefined>;
      }
    ).resource(apiVersion, kind);

  const out: ApplyOutcome[] = [];
  for (const doc of docs) {
    const outcome: ApplyOutcome = {
      apiVersion: doc.apiVersion,
      kind: doc.kind,
      name: doc.metadata.name,
      action: "error",
    };
    out.push(outcome);
    try {
      const res = await discover(doc.apiVersion, doc.kind);
      if (!res) throw new Error(`Unknown API version and kind: ${doc.apiVersion} ${doc.kind}`);
      const spec = structuredClone(doc) as KubernetesObject;
      const meta = spec.metadata!;
      if (res.namespaced) {
        meta.namespace ||= opts.namespace || undefined;
      } else {
        delete meta.namespace;
      }
      outcome.namespace = meta.namespace;

      const live = await b.objects
        .read({ apiVersion: doc.apiVersion, kind: doc.kind, metadata: { name: doc.metadata.name, namespace: meta.namespace } })
        .catch((err: unknown) => {
          if (errorCode(err) === 404) return null;
          throw err;
        });
      const result = await b.objects.patch(
        spec,
        undefined,
        opts.dryRun ? "All" : undefined,
        FIELD_MANAGER,
        opts.force ?? false,
        PatchStrategy.ServerSideApply,
      );
      // The client defaulted the namespace onto `spec` if it was still unset.
      outcome.namespace = res.namespaced ? (result.metadata?.namespace ?? meta.namespace) : undefined;
      const { action, diff } = describeChange(live, result);
      outcome.action = action;
      outcome.diff = diff;
    } catch (err) {
      const body = errorBody(err);
      if (errorCode(err) === 409) {
        outcome.action = "conflict";
        const causes = body?.details?.causes ?? [];
        outcome.conflicts = causes.length
          ? causes.map((c) => ({ field: c.field, message: c.message ?? "conflict" }))
          : [{ message: body?.message ?? formatError(err) }];
        outcome.error = body?.message;
      } else {
        outcome.action = "error";
        outcome.error = body?.message ?? formatError(err);
      }
    }
  }
  return out;
}
