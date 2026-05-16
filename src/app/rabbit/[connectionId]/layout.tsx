import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { RabbitConfig } from "@/lib/connections/types";
import { Activity, Network } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function RabbitWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<RabbitConfig>(connectionId, "rabbit");
  const tech = getTech("rabbit")!;
  const vhostSuffix =
    record.config.vhost === "/" ? "" : record.config.vhost;
  const subtitle = `${record.config.user}@${record.config.host}:${record.config.port}${vhostSuffix}`;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/rabbit/${connectionId}`}
            icon={<Activity className="size-4" />}
            exact
          >
            Overview
          </SidebarLink>
          <SidebarLink
            href={`/rabbit/${connectionId}/queues`}
            icon={<Network className="size-4" />}
          >
            Queues
          </SidebarLink>
        </SidebarSection>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
