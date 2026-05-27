import { buildMockCluster } from "@/lib/kubernetes/mock-cluster";
import { DeploymentsView } from "./deployments-view";

export const dynamic = "force-dynamic";

export default async function DeploymentsPage() {
  const cluster = buildMockCluster();
  return <DeploymentsView rows={cluster.deployments} />;
}
