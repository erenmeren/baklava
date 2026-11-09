import { requireConnection } from "@/lib/connections/server";
import { listResource } from "@/lib/connections/kubernetes/watch";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import type { K8sList } from "@/lib/kubernetes/list";
import { resolveNamespace } from "@/lib/kubernetes/namespace";

export interface ListPageProps {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ ns?: string | string[] }>;
}

/**
 * The server half of a catalogue page whose list goes through WATCH_SPECS:
 * resolve the connection and namespace, run the bounded list, and hand back
 * rows or the error for LoadError. Cluster-scoped specs ignore the namespace.
 */
export async function loadList<T>(
  { params, searchParams }: ListPageProps,
  resource: string,
): Promise<{ ok: true; list: K8sList<T> } | { ok: false; error: string }> {
  const [{ connectionId }, search] = await Promise.all([params, searchParams]);
  const record = requireConnection<KubernetesConfig>(connectionId, "kubernetes");
  return listResource<T>(
    connectionId,
    record.config,
    resource,
    resolveNamespace(search.ns, record.config.namespace),
  ).then(
    (list) => ({ ok: true as const, list }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );
}
