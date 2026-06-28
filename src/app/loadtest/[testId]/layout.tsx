import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { SidebarLink, SidebarSection } from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireLoadTest } from "@/lib/loadtest/server";
import { Settings, Play, History } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ testId: string }>;
  children: React.ReactNode;
}

export default async function LoadTestWorkspaceLayout({ params, children }: LayoutProps) {
  const { testId } = await params;
  const test = await requireLoadTest(testId);
  const tech = getTech("loadtest")!;
  return (
    <WorkspaceShell
      tech={tech}
      connectionName={test.name}
      connectionId={testId}
      subtitle={test.config.target.baseUrl}
      sidebar={
        <SidebarSection>
          <SidebarLink href={`/loadtest/${testId}/config`} icon={<Settings className="size-4" />}>Config</SidebarLink>
          <SidebarLink href={`/loadtest/${testId}/run`} icon={<Play className="size-4" />}>Run</SidebarLink>
          <SidebarLink href={`/loadtest/${testId}/history`} icon={<History className="size-4" />}>History</SidebarLink>
        </SidebarSection>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
