import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { ChromaConfig } from "@/lib/connections/types";
import { Activity, Boxes } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function ChromaWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<ChromaConfig>(connectionId, "chroma");
  const tech = getTech("chroma")!;
  const tenant = record.config.tenant || "default_tenant";
  const database = record.config.database || "default_database";
  const subtitle = `${record.config.url} · ${tenant}/${database}`;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/chroma/${connectionId}`}
            icon={<Activity className="size-4" />}
            exact
          >
            Overview
          </SidebarLink>
          <SidebarLink
            href={`/chroma/${connectionId}/collections`}
            icon={<Boxes className="size-4" />}
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
