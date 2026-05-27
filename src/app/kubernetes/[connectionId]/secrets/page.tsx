import { buildMockCluster } from "@/lib/kubernetes/mock-cluster";
import { SecretsView } from "./secrets-view";

export const dynamic = "force-dynamic";

export default async function SecretsPage() {
  const cluster = buildMockCluster();
  return <SecretsView rows={cluster.secrets} />;
}
