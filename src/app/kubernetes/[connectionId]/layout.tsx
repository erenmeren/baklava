import { headers } from "next/headers";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { KubernetesConfig } from "@/lib/connections/types";
import { bundleFor, listNamespaces, probe } from "@/lib/connections/kubernetes";
import { getCurrentUser } from "@/lib/auth/current-user";
import { K8sSidebar } from "./k8s-sidebar";
import { K8sShell } from "./k8s-shell";
import { ContextSwitcher } from "./context-switcher";

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

  // Probe + namespaces are best-effort. If the cluster is unreachable we still
  // render the shell so the user can navigate to /kubernetes and fix the
  // connection without a hard 500.
  const [probeResult, nsRows, contexts] = await Promise.all([
    probe(connectionId, cfg).catch(() => null),
    listNamespaces(connectionId, cfg).catch(() => null),
    // Names only — the kubeconfig itself never goes to the browser.
    bundleFor(connectionId, cfg).then(
      (b) => b.kc.getContexts().map((c) => c.name),
      () => [] as string[],
    ),
  ]);
  // `context` is a target key (target-keys.ts): the PATCH refuses anyone else.
  const user = getCurrentUser({ headers: await headers() });
  const canSwitchContext = user?.role === "admin" || (!!user && user.id === record.ownerId);

  const context = probeResult?.context || cfg.context || "current-context";
  const serverVersion = probeResult?.serverVersion || "unknown";
  const nodeCount = probeResult?.nodeCount ?? 0;
  const subtitle = `${context} · ${serverVersion}`;
  const namespaceNames = (nsRows?.rows ?? []).map((n) => n.name);

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      connectionId={connectionId}
      subtitle={subtitle}
      sidebar={
        <K8sSidebar
          connectionId={connectionId}
          context={context}
          serverVersion={serverVersion}
          nodes={nodeCount}
          namespaceCount={namespaceNames.length}
        />
      }
    >
      <K8sShell
        connectionId={connectionId}
        namespaces={namespaceNames}
        defaultNamespace={cfg.namespace ?? ""}
        context={context}
        serverVersion={serverVersion}
        contextSlot={
          <ContextSwitcher
            connectionId={connectionId}
            current={context}
            contexts={contexts}
            canSwitch={canSwitchContext}
          />
        }
      >
        {children}
      </K8sShell>
    </WorkspaceShell>
  );
}
