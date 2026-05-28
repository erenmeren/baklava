import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { listDatabases, probe } from "@/lib/connections/mongo";
import { MongoSidebar } from "./mongo-sidebar";

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
  const [probeResult, databases] = await Promise.all([
    probe(connectionId, record.config).catch(() => null),
    listDatabases(connectionId, record.config).catch(() => []),
  ]);

  const subtitle = probeResult
    ? `${probeResult.version} · ${probeResult.topology}`
    : "unreachable";

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <MongoSidebar
          connectionId={connectionId}
          databases={databases.map((d) => ({ name: d.name, sizeOnDisk: d.sizeOnDisk }))}
          version={probeResult?.version ?? "unknown"}
          topology={probeResult?.topology ?? "?"}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
