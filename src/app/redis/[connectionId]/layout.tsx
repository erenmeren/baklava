import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import { probe } from "@/lib/connections/redis";
import { RedisSidebar } from "./redis-sidebar";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function RedisWorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<RedisConfig>(connectionId, "redis");
  const tech = getTech("redis")!;

  // Probe is best-effort; an unreachable Redis still renders the shell so
  // the user can navigate back to /redis and edit the connection.
  const result = await probe(connectionId, record.config).catch(() => null);

  const subtitle = result
    ? `${result.version} · ${result.mode} · ${result.role}`
    : "unreachable";

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      connectionId={connectionId}
      subtitle={subtitle}
      sidebar={
        <RedisSidebar
          connectionId={connectionId}
          mode={record.config.mode}
          databases={result?.databases ?? 16}
          modules={result?.modules ?? []}
          isCluster={record.config.mode === "cluster"}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
