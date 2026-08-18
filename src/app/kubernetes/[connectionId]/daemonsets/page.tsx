import { requireConnection } from "@/lib/connections/server";
import { listDaemonSets } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { resolveNamespace } from "@/lib/kubernetes/namespace";
import { DaemonSetsView } from "./daemonsets-view";
import { LoadError } from "../load-error";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ ns?: string | string[] }>;
}

export default async function DaemonSetsPage({ params, searchParams }: Props) {
  const [{ connectionId }, search] = await Promise.all([params, searchParams]);
  const record = requireConnection<KubernetesConfig>(connectionId, "kubernetes");
  const result = await listDaemonSets(
    connectionId,
    record.config,
    resolveNamespace(search.ns, record.config.namespace),
  ).then(
    (rows) => ({ ok: true as const, rows }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );
  return result.ok ? (
    <DaemonSetsView rows={result.rows} />
  ) : (
    <LoadError resource="daemon sets" error={result.error} />
  );
}
