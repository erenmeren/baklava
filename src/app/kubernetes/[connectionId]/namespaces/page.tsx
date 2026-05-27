import { buildMockCluster } from "@/lib/kubernetes/mock-cluster";
import { NamespacesView } from "./namespaces-view";

export const dynamic = "force-dynamic";

export default async function NamespacesPage() {
  const cluster = buildMockCluster();
  return <NamespacesView rows={cluster.namespaces} />;
}
