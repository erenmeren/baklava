import Link from "next/link";
import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { listDatabases } from "@/lib/connections/mongo";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

function formatSize(b: number): string {
  if (!b) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)}MB`;
  return `${(b / 1024 ** 3).toFixed(2)}GB`;
}

export default async function DatabasesPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<MongoConfig>(connectionId, "mongo");
  const result = await listDatabases(connectionId, record.config).then(
    (databases) => ({ ok: true as const, databases }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );

  return (
    <WorkspacePage
      title="Databases"
      description="Every database on the cluster. Click one to browse its collections."
    >
      {result.ok ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {result.databases.map((d) => (
            <Link
              key={d.name}
              href={`/mongo/${connectionId}/databases/${encodeURIComponent(d.name)}`}
              className="group block border border-border/60 rounded-md p-4 hover:border-emerald-500/40 hover:bg-emerald-500/[0.03] transition-colors"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-mono text-sm font-medium truncate" title={d.name}>
                  {d.name}
                </h3>
                {d.empty ? (
                  <span className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                    empty
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex items-end justify-between text-[11px]">
                <span className="text-muted-foreground uppercase tracking-[0.18em] text-[9px]">
                  on disk
                </span>
                <span className="font-mono tabular-nums text-foreground">
                  {formatSize(d.sizeOnDisk)}
                </span>
              </div>
            </Link>
          ))}
          {result.databases.length === 0 ? (
            <div className="col-span-full px-4 py-12 text-center text-muted-foreground text-xs">
              no databases
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
          {result.error}
        </div>
      )}
    </WorkspacePage>
  );
}
