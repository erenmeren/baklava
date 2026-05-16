import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { MilvusConfig } from "@/lib/connections/types";
import { Activity, Boxes } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function MilvusWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<MilvusConfig>(connectionId, "milvus");
  const tech = getTech("milvus")!;
  const subtitle = record.config.address;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/milvus/${connectionId}`}
            icon={<Activity className="size-4" />}
            exact
          >
            Overview
          </SidebarLink>
          <SidebarLink
            href={`/milvus/${connectionId}/collections`}
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
