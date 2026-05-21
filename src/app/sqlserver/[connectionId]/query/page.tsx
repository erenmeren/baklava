import { redirect } from "next/navigation";
import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

// The query editor moved under databases/[db]/query/[queryId] (per-tab, like
// Postgres). Keep /query as a redirect into the connection's default database
// so older links and the command palette still resolve.
export default async function SqlServerLegacyQueryRedirect({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<SqlServerConfig>(connectionId, "sqlserver");
  redirect(
    `/sqlserver/${connectionId}/databases/${encodeURIComponent(record.config.database)}/query`,
  );
}
