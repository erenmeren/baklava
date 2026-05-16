import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { Activity, Layers } from "lucide-react";

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
  const subtitle = record.config.url;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/qdrant/${connectionId}`}
            icon={<Activity className="size-4" />}
            exact
          >
            Overview
          </SidebarLink>
          <SidebarLink
            href={`/qdrant/${connectionId}/collections`}
            icon={<Layers className="size-4" />}
          >
            Collections
          </SidebarLink>
        </SidebarSection>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
