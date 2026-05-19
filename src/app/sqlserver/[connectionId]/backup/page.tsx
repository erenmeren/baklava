import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";
import { BackupClient } from "./backup-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SqlServerBackupPage({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<SqlServerConfig>(connectionId, "sqlserver");
  return (
    <BackupClient connectionId={connectionId} defaultDatabase={record.config.database} />
  );
}
