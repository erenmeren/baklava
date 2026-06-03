import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { MysqlConfig } from "@/lib/connections/types";
import { MysqlSidebar } from "./mysql-sidebar";
import { MysqlTabs } from "./mysql-tabs";
import { CommandPaletteHost } from "./command-palette-host";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function MysqlWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<MysqlConfig>(connectionId, "mysql");
  const tech = getTech("mysql")!;
  const cfg = record.config;
  const subtitle = `${cfg.user}@${cfg.host}:${cfg.port}`;

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      connectionId={connectionId}
      subtitle={subtitle}
      sidebar={
        <MysqlSidebar
          connectionId={connectionId}
          defaultDatabase={cfg.database}
        />
      }
    >
      <div className="flex flex-col h-full min-h-0">
        <MysqlTabs
          connectionId={connectionId}
          defaultDatabase={cfg.database}
        />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
      <CommandPaletteHost
        connectionId={connectionId}
        defaultDatabase={cfg.database}
      />
    </WorkspaceShell>
  );
}
