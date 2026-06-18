import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { probeQdrant } from "@/lib/connections/qdrant";
import { QdrantSidebar } from "./qdrant-sidebar";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function QdrantWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<QdrantConfig>(connectionId, "qdrant");
  const tech = getTech("qdrant")!;
  // Probe is best-effort; an unreachable server still renders the shell so
  // the user can navigate back to / and fix the connection.
  const result = await probeQdrant(record.config).catch(() => null);
  const subtitle = result
    ? `${result.collectionCount} collections`
    : "unreachable";

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      connectionId={connectionId}
      subtitle={subtitle}
      sidebar={<QdrantSidebar connectionId={connectionId} />}
    >
      {children}
    </WorkspaceShell>
  );
}
