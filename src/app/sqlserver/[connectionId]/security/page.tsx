import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";
import { SecurityClient } from "./security-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SqlServerSecurityPage({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<SqlServerConfig>(connectionId, "sqlserver");
  return (
    <SecurityClient connectionId={connectionId} defaultDatabase={record.config.database} />
  );
}
