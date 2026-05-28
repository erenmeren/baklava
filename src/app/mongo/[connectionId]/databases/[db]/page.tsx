import Link from "next/link";
import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { listCollections } from "@/lib/connections/mongo";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string; db: string }>;
}

function formatSize(b: number): string {
  if (!b) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)}MB`;
  return `${(b / 1024 ** 3).toFixed(2)}GB`;
}

export default async function DatabasePage({ params }: Props) {
  const { connectionId, db } = await params;
  const dbName = decodeURIComponent(db);
  const record = requireConnection<MongoConfig>(connectionId, "mongo");
  const result = await listCollections(connectionId, record.config, dbName).then(
    (collections) => ({ ok: true as const, collections }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );

  return (
    <WorkspacePage
      title={dbName}
      description="Collections, view counts, sizes and index counts at a glance."
    >
      {result.ok ? (
        <div className="border border-border/60 rounded-md overflow-hidden">
          <table className="w-full font-mono text-xs">
            <thead className="bg-muted/30 border-b border-border/60">
              <tr>
                {["name", "type", "docs", "size", "storage", "avg obj", "idx"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.collections.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    no collections
                  </td>
                </tr>
              ) : (
                result.collections.map((c) => (
                  <tr
                    key={c.name}
                    className="border-b border-border/40 last:border-0 hover:bg-foreground/[0.02]"
                  >
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/mongo/${connectionId}/databases/${encodeURIComponent(dbName)}/${encodeURIComponent(c.name)}`}
                        className="text-emerald-700 dark:text-emerald-400 hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{c.type}</td>
                    <td className="px-3 py-1.5 tabular-nums">{c.count.toLocaleString()}</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatSize(c.size)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                      {formatSize(c.storageSize)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                      {c.avgObjSize ? formatSize(c.avgObjSize) : "—"}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{c.indexes}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
          {result.error}
        </div>
      )}
    </WorkspacePage>
  );
}
