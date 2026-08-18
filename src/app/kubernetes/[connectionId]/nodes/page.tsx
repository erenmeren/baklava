import { requireConnection } from "@/lib/connections/server";
import { listNodes } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { NodesView } from "./nodes-view";
import { LoadError } from "../load-error";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function NodesPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<KubernetesConfig>(connectionId, "kubernetes");
  // Nodes are cluster-scoped — the namespace selector doesn't apply.
  const result = await listNodes(connectionId, record.config).then(
    (rows) => ({ ok: true as const, rows }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );
  return result.ok ? (
    <NodesView rows={result.rows} />
  ) : (
    <LoadError resource="nodes" error={result.error} />
  );
}
