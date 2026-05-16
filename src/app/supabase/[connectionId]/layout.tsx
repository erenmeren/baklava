import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { SupabaseConfig } from "@/lib/connections/types";
import { Activity, FolderArchive, Users, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function SupabaseWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<SupabaseConfig>(connectionId, "supabase");
  const tech = getTech("supabase")!;
  const subtitle = record.config.url.replace(/^https?:\/\//, "");

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <>
          <SidebarSection title="Project">
            <SidebarLink
              href={`/supabase/${connectionId}`}
              icon={<Activity className="size-4" />}
              exact
            >
              Overview
            </SidebarLink>
          </SidebarSection>
          <SidebarSection title="Auth">
            <SidebarLink
              href={`/supabase/${connectionId}/auth-users`}
              icon={<Users className="size-4" />}
            >
              Users
            </SidebarLink>
          </SidebarSection>
          <SidebarSection title="Storage">
            <SidebarLink
              href={`/supabase/${connectionId}/buckets`}
              icon={<FolderArchive className="size-4" />}
            >
              Buckets
            </SidebarLink>
          </SidebarSection>
          <SidebarSection title="Functions">
            <SidebarLink
              href={`/supabase/${connectionId}/functions`}
              icon={<Zap className="size-4" />}
            >
              Edge functions
            </SidebarLink>
          </SidebarSection>
        </>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
