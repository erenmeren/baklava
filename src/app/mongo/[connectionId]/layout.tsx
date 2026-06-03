import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { probe } from "@/lib/connections/mongo";
import { MongoSidebar } from "./mongo-sidebar";
import { MongoTabs } from "./mongo-tabs";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function MongoWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<MongoConfig>(connectionId, "mongo");
  const tech = getTech("mongo")!;
  // Probe is best-effort; an unreachable server still renders the shell so
  // the user can navigate back to /mongo and fix the connection.
  const result = await probe(connectionId, record.config).catch(() => null);
  const subtitle = result
    ? `${result.version} · ${result.topology}`
    : "unreachable";

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      connectionId={connectionId}
      subtitle={subtitle}
      sidebar={
        <MongoSidebar
          connectionId={connectionId}
          defaultDatabase={record.config.defaultDb ?? ""}
        />
      }
    >
      <div className="flex flex-col h-full min-h-0">
        <MongoTabs connectionId={connectionId} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
