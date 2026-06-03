import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { DockerConfig } from "@/lib/connections/types";
import {
  Container as ContainerIcon,
  Box,
  HardDrive,
  Network,
  Activity,
  Radio,
  KeyRound,
  Layers,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function DockerWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<DockerConfig>(connectionId, "docker");
  const tech = getTech("docker")!;
  const cfg = record.config;
  const subtitle =
    cfg.mode === "tcp"
      ? `${cfg.protocol}://${cfg.host}:${cfg.port}`
      : `socket: ${cfg.socketPath}`;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      connectionId={connectionId}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/docker/${connectionId}/containers`}
            icon={<ContainerIcon className="size-4" />}
          >
            Containers
          </SidebarLink>
          <SidebarLink
            href={`/docker/${connectionId}/images`}
            icon={<Box className="size-4" />}
          >
            Images
          </SidebarLink>
          <SidebarLink
            href={`/docker/${connectionId}/volumes`}
            icon={<HardDrive className="size-4" />}
          >
            Volumes
          </SidebarLink>
          <SidebarLink
            href={`/docker/${connectionId}/networks`}
            icon={<Network className="size-4" />}
          >
            Networks
          </SidebarLink>
          <SidebarLink
            href={`/docker/${connectionId}/stacks`}
            icon={<Layers className="size-4" />}
          >
            Stacks
          </SidebarLink>
          <SidebarLink
            href={`/docker/${connectionId}/registries`}
            icon={<KeyRound className="size-4" />}
          >
            Registries
          </SidebarLink>
          <SidebarLink
            href={`/docker/${connectionId}/events`}
            icon={<Radio className="size-4" />}
          >
            Events
          </SidebarLink>
          <SidebarLink
            href={`/docker/${connectionId}/system`}
            icon={<Activity className="size-4" />}
          >
            System
          </SidebarLink>
        </SidebarSection>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
