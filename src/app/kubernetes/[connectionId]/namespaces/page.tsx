import { requireConnection } from "@/lib/connections/server";
import { listNamespaces } from "@/lib/connections/kubernetes";
import type { KubernetesConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { NamespacesView } from "./namespaces-view";
import { LoadError } from "../load-error";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function NamespacesPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<KubernetesConfig>(connectionId, "kubernetes");
  const result = await listNamespaces(connectionId, record.config).then(
    (list) => ({ ok: true as const, list }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );
  return result.ok ? (
    <NamespacesView list={result.list} />
  ) : (
    <LoadError resource="namespaces" error={result.error} />
  );
}
