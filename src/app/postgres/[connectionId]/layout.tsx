import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { PostgresConfig } from "@/lib/connections/types";
import { PostgresSidebar } from "./postgres-sidebar";

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
      {children}
    </WorkspaceShell>
  );
}
