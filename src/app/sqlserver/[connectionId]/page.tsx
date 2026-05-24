import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";
import { OverviewClient } from "./overview-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SqlServerOverviewPage({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<SqlServerConfig>(connectionId, "sqlserver");
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
