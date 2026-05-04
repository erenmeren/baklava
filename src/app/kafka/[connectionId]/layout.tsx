import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { KafkaConfig } from "@/lib/connections/types";
import { Server, Network, Users } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function KafkaWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<KafkaConfig>(connectionId, "kafka");
  const tech = getTech("kafka")!;
  const subtitle = record.config.brokers.join(", ");

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/kafka/${connectionId}/topics`}
            icon={<Network className="size-4" />}
          >
            Topics
          </SidebarLink>
          <SidebarLink
            href={`/kafka/${connectionId}/consumer-groups`}
            icon={<Users className="size-4" />}
          >
            Consumer groups
          </SidebarLink>
          <SidebarLink
            href={`/kafka/${connectionId}/brokers`}
            icon={<Server className="size-4" />}
          >
            Brokers
          </SidebarLink>
        </SidebarSection>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
