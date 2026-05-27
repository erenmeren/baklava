import { buildMockCluster } from "@/lib/kubernetes/mock-cluster";
import { PodsView } from "./pods-view";

export const dynamic = "force-dynamic";

export default async function PodsPage() {
  const cluster = buildMockCluster();
  return <PodsView rows={cluster.pods} />;
}
