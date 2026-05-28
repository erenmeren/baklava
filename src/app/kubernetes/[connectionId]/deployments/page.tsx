import { requireConnection } from "@/lib/connections/server";
import { listDeployments } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { DeploymentsView } from "./deployments-view";
import { LoadError } from "../load-error";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function DeploymentsPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<KubernetesConfig>(connectionId, "kubernetes");
  const result = await listDeployments(connectionId, record.config).then(
    (rows) => ({ ok: true as const, rows }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );
  return result.ok ? (
    <DeploymentsView rows={result.rows} />
  ) : (
    <LoadError resource="deployments" error={result.error} />
  );
}
