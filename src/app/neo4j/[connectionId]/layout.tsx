import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { Neo4jConfig } from "@/lib/connections/types";
import { Activity, Database } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function Neo4jWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<Neo4jConfig>(connectionId, "neo4j");
  const tech = getTech("neo4j")!;
  const subtitle = `${record.config.user}@${record.config.uri}${
    record.config.database ? `/${record.config.database}` : ""
  }`;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/neo4j/${connectionId}`}
            icon={<Activity className="size-4" />}
            exact
          >
            Overview
          </SidebarLink>
          <SidebarLink
            href={`/neo4j/${connectionId}/databases`}
            icon={<Database className="size-4" />}
          >
            Databases
          </SidebarLink>
        </SidebarSection>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
