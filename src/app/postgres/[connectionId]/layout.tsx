import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { PostgresConfig } from "@/lib/connections/types";
import { PostgresSidebar } from "./postgres-sidebar";
import { PostgresTabs } from "./postgres-tabs";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function PostgresWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<PostgresConfig>(connectionId, "postgres");
  const tech = getTech("postgres")!;
  const cfg = record.config;
  const subtitle = `${cfg.user}@${cfg.host}:${cfg.port}`;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <PostgresSidebar
          connectionId={connectionId}
          defaultDatabase={cfg.database}
        />
      }
    >
      <div className="flex flex-col h-full min-h-0">
        <PostgresTabs connectionId={connectionId} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
