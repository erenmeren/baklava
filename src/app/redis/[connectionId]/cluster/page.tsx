import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import { getClusterNodes } from "@/lib/connections/redis";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function ClusterPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<RedisConfig>(connectionId, "redis");

  if (record.config.mode !== "cluster") {
    return (
      <WorkspacePage title="Cluster">
        <div className="px-4 py-12 text-center text-muted-foreground text-xs">
          This connection is a single-instance Redis; cluster topology is
          only meaningful in cluster mode.
        </div>
      </WorkspacePage>
    );
  }

  const result = await getClusterNodes(connectionId, record.config).then(
    (nodes) => ({ ok: true as const, nodes }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );

  return (
    <WorkspacePage
      title="Cluster topology"
      description="CLUSTER NODES output — masters, replicas, and slot ranges they cover."
    >
      {result.ok ? (
        <div className="border border-border/60 rounded-md overflow-hidden">
          <table className="w-full font-mono text-xs">
            <thead className="bg-muted/30 border-b border-border/60">
              <tr>
                {["id", "addr", "role", "slots", "flags"].map((h) => (
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
              {result.nodes.map((n) => (
                <tr
                  key={n.id}
                  className="border-b border-border/40 last:border-0"
                >
                  <td className="px-3 py-1 truncate max-w-[160px]" title={n.id}>
                    {n.id.slice(0, 12)}…
                  </td>
                  <td className="px-3 py-1 text-muted-foreground">{n.addr}</td>
                  <td className="px-3 py-1">
                    <span
                      className={cn(
                        "uppercase tracking-[0.18em] text-[9px] px-1.5 py-0.5 rounded",
                        n.role === "master"
                          ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                          : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
                      )}
                    >
                      {n.role}
                    </span>
                  </td>
                  <td className="px-3 py-1 tabular-nums">{n.slotsCovered}</td>
                  <td className="px-3 py-1 text-muted-foreground">{n.flags}</td>
                </tr>
              ))}
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
