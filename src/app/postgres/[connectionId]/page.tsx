import { requireConnection } from "@/lib/connections/server";
import type { PostgresConfig } from "@/lib/connections/types";
import { OverviewClient } from "./overview-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function PostgresWorkspaceIndex({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<PostgresConfig>(connectionId, "postgres");
  const cfg = record.config;
  return (
    <OverviewClient
      connectionId={connectionId}
      connectionName={record.name}
      defaultDatabase={cfg.database}
      hostPort={`${cfg.user}@${cfg.host}:${cfg.port}`}
    />
  );
}
