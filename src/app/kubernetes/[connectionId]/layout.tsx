import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { KubernetesConfig } from "@/lib/connections/types";
import { buildMockCluster } from "@/lib/kubernetes/mock-cluster";
import { K8sSidebar } from "./k8s-sidebar";
import { K8sShell } from "./k8s-shell";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function KubernetesWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<KubernetesConfig>(
    connectionId,
    "kubernetes",
  );
  const tech = getTech("kubernetes")!;
  const cfg = record.config;
  const cluster = buildMockCluster();
  const subtitle = `${cluster.context} · ${cluster.serverVersion}`;

  const counts = {
    pods: cluster.pods.length,
    deployments: cluster.deployments.length,
    services: cluster.services.length,
    configMaps: cluster.configMaps.length,
    secrets: cluster.secrets.length,
    namespaces: cluster.namespaces.length,
  };

  const initialNamespace = cfg.namespace || "default";

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <K8sSidebar
          connectionId={connectionId}
          counts={counts}
          context={cluster.context}
          serverVersion={cluster.serverVersion}
          nodes={cluster.nodes.length}
        />
      }
    >
      <K8sShell
        connectionId={connectionId}
        namespaces={cluster.namespaces.map((n) => n.name)}
        initialNamespace={initialNamespace}
        context={cluster.context}
        serverVersion={cluster.serverVersion}
      >
        {children}
      </K8sShell>
    </WorkspaceShell>
  );
}
