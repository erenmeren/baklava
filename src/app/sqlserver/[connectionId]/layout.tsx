import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";
import { SqlServerSidebar } from "./sqlserver-sidebar";
import { SqlServerTabs } from "./sqlserver-tabs";
import { CommandPaletteHost } from "./command-palette-host";

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
  const cfg = record.config;
  const subtitle = `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      connectionId={connectionId}
      subtitle={subtitle}
      sidebar={
        <SqlServerSidebar
          connectionId={connectionId}
          defaultDatabase={cfg.database}
        />
      }
    >
      <div className="flex flex-col h-full min-h-0">
        <SqlServerTabs connectionId={connectionId} defaultDatabase={cfg.database} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
      <CommandPaletteHost
        connectionId={connectionId}
        defaultDatabase={cfg.database}
      />
    </WorkspaceShell>
  );
}
