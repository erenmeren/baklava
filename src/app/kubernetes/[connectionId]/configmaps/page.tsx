import { buildMockCluster } from "@/lib/kubernetes/mock-cluster";
import { ConfigMapsView } from "./configmaps-view";

export const dynamic = "force-dynamic";

export default async function ConfigMapsPage() {
  const cluster = buildMockCluster();
  return <ConfigMapsView rows={cluster.configMaps} />;
}
