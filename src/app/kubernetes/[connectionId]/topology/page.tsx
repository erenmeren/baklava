import { requireConnection } from "@/lib/connections/server";
import { getClusterTopology } from "@/lib/connections/kubernetes/topology";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { resolveNamespace } from "@/lib/kubernetes/namespace";
import { TopologyView } from "./topology-view";
import { LoadError } from "../load-error";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ ns?: string | string[] }>;
}

export default async function KubernetesTopologyPage({ params, searchParams }: Props) {
  const [{ connectionId }, search] = await Promise.all([params, searchParams]);
  const record = requireConnection<KubernetesConfig>(connectionId, "kubernetes");
  const result = await getClusterTopology(
    connectionId,
    record.config,
    resolveNamespace(search.ns, record.config.namespace),
  ).then(
    (topology) => ({ ok: true as const, topology }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );
  return result.ok ? (
    <TopologyView topology={result.topology} />
  ) : (
    <LoadError resource="cluster topology" error={result.error} />
  );
}
