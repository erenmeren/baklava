import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarLink,
  SidebarSection,
} from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { buildMongoUri } from "@/lib/connections/mongo";
import { Activity, Database } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

function describeMongo(config: MongoConfig): string {
  if (config.uri) {
    try {
      const u = new URL(config.uri);
      return `${u.hostname}${u.port ? ":" + u.port : ""}`;
    } catch {
      return config.uri;
    }
  }
  const host = config.host || "localhost";
  const port = config.port || 27017;
  return `${host}:${port}`;
}

export default async function MongoWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<MongoConfig>(connectionId, "mongo");
  const tech = getTech("mongo")!;
  // Touch buildMongoUri so the import isn't dead — also surfaces config
  // typos at layout time rather than first API call.
  try { buildMongoUri(record.config); } catch { /* ignore */ }
  const subtitle = describeMongo(record.config);

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <SidebarSection>
          <SidebarLink
            href={`/mongo/${connectionId}`}
            icon={<Activity className="size-4" />}
            exact
          >
            Overview
          </SidebarLink>
          <SidebarLink
            href={`/mongo/${connectionId}/databases`}
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
