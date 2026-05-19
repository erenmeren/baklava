import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";
import { Activity, Database, Gauge, Terminal } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function SqlServerWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<SqlServerConfig>(connectionId, "sqlserver");
  const tech = getTech("sqlserver")!;
  const subtitle = `${record.config.user}@${record.config.host}:${record.config.port}/${record.config.database}`;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/sqlserver/${connectionId}`}
            icon={<Gauge className="size-4" />}
            exact
          >
            Overview
          </SidebarLink>
          <SidebarLink
            href={`/sqlserver/${connectionId}/databases`}
            icon={<Database className="size-4" />}
          >
            Databases
          </SidebarLink>
          <SidebarLink
            href={`/sqlserver/${connectionId}/query`}
            icon={<Terminal className="size-4" />}
          >
            Query editor
          </SidebarLink>
          <SidebarLink
            href={`/sqlserver/${connectionId}/activity`}
            icon={<Activity className="size-4" />}
          >
            Activity
          </SidebarLink>
        </SidebarSection>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
