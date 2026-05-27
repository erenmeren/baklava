import { buildMockCluster } from "@/lib/kubernetes/mock-cluster";
import { ServicesView } from "./services-view";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const cluster = buildMockCluster();
  return <ServicesView rows={cluster.services} />;
}
