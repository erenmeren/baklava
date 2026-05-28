import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { replSetStatus } from "@/lib/connections/mongo";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

const STATE_COLOR: Record<string, string> = {
  PRIMARY: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  SECONDARY: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  ARBITER: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  RECOVERING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  STARTUP: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  STARTUP2: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  DOWN: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  ROLLBACK: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  REMOVED: "bg-zinc-500/15 text-muted-foreground",
};

export default async function ReplStatusPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<MongoConfig>(connectionId, "mongo");
  const result = await replSetStatus(connectionId, record.config).then(
    (status) => ({ ok: true as const, status }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );

  if (!result.ok) {
    return (
      <WorkspacePage title="Replica set status">
        <div className="rounded border border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300 text-xs font-mono px-3 py-2">
          {result.error.includes("not running with --replSet")
            ? "This server is not running as a replica set."
            : result.error}
        </div>
      </WorkspacePage>
    );
  }

  const { status } = result;
  return (
    <WorkspacePage
      title={`Replica set${status.set ? ` · ${status.set}` : ""}`}
      description="rs.status() snapshot — member states, uptime, and replication lag against the primary."
    >
      <div className="border border-border/60 rounded-md overflow-hidden">
        <table className="w-full font-mono text-xs">
          <thead className="bg-muted/30 border-b border-border/60">
            <tr>
              {["member", "state", "health", "uptime", "optime", "lag"].map((h) => (
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
            {status.members.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  no members
                </td>
              </tr>
            ) : (
              status.members.map((m) => (
                <tr
                  key={m.name}
                  className="border-b border-border/40 last:border-0"
                >
                  <td className="px-3 py-1.5">
                    {m.name}
                    {m.isSelf ? (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                        self
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "uppercase tracking-[0.15em] text-[9px] px-1.5 py-0.5 rounded",
                        STATE_COLOR[m.state] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {m.state}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    <span
                      className={cn(
                        m.health > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {m.health > 0 ? "✓ healthy" : "✗ unhealthy"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                    {m.uptime
                      ? `${Math.floor(m.uptime / 86400)}d ${Math.floor((m.uptime % 86400) / 3600)}h`
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                    {m.optimeDate
                      ? new Date(m.optimeDate).toISOString().slice(0, 19)
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    <span
                      className={cn(
                        m.lagSeconds > 10
                          ? "text-rose-600 dark:text-rose-400"
                          : m.lagSeconds > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {m.lagSeconds === 0 ? "—" : `${m.lagSeconds}s`}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </WorkspacePage>
  );
}
