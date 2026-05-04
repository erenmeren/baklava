import { WorkspacePage } from "@/components/workspace/workspace-page";
import { requireConnection } from "@/lib/connections/server";
import type { PostgresConfig } from "@/lib/connections/types";
import Link from "next/link";
import { FileText } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function PostgresWorkspaceIndex({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<PostgresConfig>(connectionId, "postgres");
  const cfg = record.config;
  return (
    <WorkspacePage
      title={record.name}
      description={`${cfg.user}@${cfg.host}:${cfg.port} · default database ${cfg.database}`}
      actions={
        <Link
          href={`/postgres/${connectionId}/databases/${encodeURIComponent(cfg.database)}/query`}
          className="inline-flex items-center gap-1.5 text-sm border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
        >
          <FileText className="size-3.5" />
          Open SQL editor
        </Link>
      }
    >
      <div className="prose prose-sm max-w-prose text-sm text-muted-foreground">
        <p>
          Use the tree on the left to browse databases, schemas and tables.
          Click any table to inspect its columns, indexes, constraints, and
          data. Click <span className="font-mono">SQL editor</span> under any
          database to run ad-hoc queries.
        </p>
      </div>
    </WorkspacePage>
  );
}
