import { requireConnection } from "@/lib/connections/server";
import { getClusterOverview } from "@/lib/connections/kubernetes/overview";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { resolveNamespace } from "@/lib/kubernetes/namespace";
import { OverviewView } from "./overview-view";
import { LoadError } from "./load-error";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ ns?: string | string[] }>;
}

export default async function KubernetesOverviewPage({ params, searchParams }: Props) {
  const [{ connectionId }, search] = await Promise.all([params, searchParams]);
  const record = requireConnection<KubernetesConfig>(connectionId, "kubernetes");
  const result = await getClusterOverview(
    connectionId,
    record.config,
    resolveNamespace(search.ns, record.config.namespace),
  ).then(
    (overview) => ({ ok: true as const, overview }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );
  return result.ok ? (
    <OverviewView overview={result.overview} />
  ) : (
    <LoadError resource="cluster overview" error={result.error} />
  );
}
