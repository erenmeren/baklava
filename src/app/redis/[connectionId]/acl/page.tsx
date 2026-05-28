import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import { getAcl } from "@/lib/connections/redis";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function AclPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<RedisConfig>(connectionId, "redis");
  const result = await getAcl(connectionId, record.config).then(
    (acl) => ({ ok: true as const, acl }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );

  return (
    <WorkspacePage
      title="ACL"
      description="Current user (ACL WHOAMI) and every user defined on the server (ACL LIST)."
    >
      {result.ok ? (
        <div className="space-y-4">
          <div className="rounded-md border border-border/60 px-4 py-3 bg-muted/20">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
              connected as
            </div>
            <div className="font-mono text-sm">{result.acl.whoami}</div>
          </div>
          <div className="border border-border/60 rounded-md overflow-hidden">
            <div className="px-3 py-1.5 border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              ACL LIST · {result.acl.list.length} user(s)
            </div>
            <pre className="font-mono text-xs leading-relaxed p-4 whitespace-pre-wrap break-words">
              {result.acl.list.join("\n") || "(no ACL entries)"}
            </pre>
          </div>
        </div>
      ) : (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
          {result.error}
        </div>
      )}
    </WorkspacePage>
  );
}
