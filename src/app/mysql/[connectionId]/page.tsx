import { requireConnection } from "@/lib/connections/server";
import type { MysqlConfig } from "@/lib/connections/types";
import { OverviewClient } from "./overview-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function MysqlWorkspaceIndex({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<MysqlConfig>(connectionId, "mysql");
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
