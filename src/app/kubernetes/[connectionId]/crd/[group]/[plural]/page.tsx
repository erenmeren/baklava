import { notFound } from "next/navigation";
import { requireConnection } from "@/lib/connections/server";
import { CrdNotFoundError, listCustomResources } from "@/lib/connections/kubernetes/crds";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { resolveNamespace } from "@/lib/kubernetes/namespace";
import { CustomResourcesView } from "./custom-resources-view";
import { LoadError } from "../../../load-error";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string; group: string; plural: string }>;
  searchParams: Promise<{ ns?: string | string[] }>;
}

/**
 * Instances of any installed CRD. `group`/`plural` must name a served CRD
 * (validated in listCustomResources) — anything else is a 404, not an API call.
 * Not live: there is no watch for custom resources; the table refreshes on
 * navigation and after mutations.
 */
export default async function CustomResourcesPage({ params, searchParams }: Props) {
  const [{ connectionId, group, plural }, search] = await Promise.all([params, searchParams]);
  const record = requireConnection<KubernetesConfig>(connectionId, "kubernetes");
  const result = await listCustomResources(
    connectionId,
    record.config,
    group,
    plural,
    resolveNamespace(search.ns, record.config.namespace),
  ).then(
    (r) => ({ ok: true as const, ...r }),
    (err: unknown) => {
      if (err instanceof CrdNotFoundError) notFound();
      return { ok: false as const, error: formatError(err) };
    },
  );
  return result.ok ? (
    <CustomResourcesView crd={result.crd} list={result.list} />
  ) : (
    <LoadError resource={`${plural}.${group}`} error={result.error} />
  );
}
