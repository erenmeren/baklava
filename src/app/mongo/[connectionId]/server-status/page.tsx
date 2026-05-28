import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { serverStatus } from "@/lib/connections/mongo";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function formatBytes(b: number | undefined) {
  if (typeof b !== "number" || !b) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)}MB`;
  return `${(b / 1024 ** 3).toFixed(2)}GB`;
}

export default async function ServerStatusPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<MongoConfig>(connectionId, "mongo");
  const result = await serverStatus(connectionId, record.config).then(
    (status) => ({ ok: true as const, status }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );

  if (!result.ok) {
    return (
      <WorkspacePage title="Server status">
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
          {result.error}
        </div>
      </WorkspacePage>
    );
  }

  const s = result.status;
  const cards: { label: string; value: string; sub?: string }[] = [
    {
      label: "Uptime",
      value: `${Math.floor((s.uptime as number) / 3600)}h ${Math.floor(((s.uptime as number) % 3600) / 60)}m`,
    },
    {
      label: "Version",
      value: String(s.version ?? "—"),
      sub: String(s.process ?? ""),
    },
    {
      label: "Current connections",
      value: String(pick(s, "connections.current") ?? "—"),
      sub: `available ${pick(s, "connections.available") ?? "—"}`,
    },
    {
      label: "Resident memory",
      value: formatBytes(
        ((pick(s, "mem.resident") as number) ?? 0) * 1024 * 1024,
      ),
      sub: `virtual ${formatBytes(((pick(s, "mem.virtual") as number) ?? 0) * 1024 * 1024)}`,
    },
    {
      label: "Network in",
      value: formatBytes(pick(s, "network.bytesIn") as number),
      sub: `requests ${pick(s, "network.numRequests")}`,
    },
    {
      label: "Network out",
      value: formatBytes(pick(s, "network.bytesOut") as number),
    },
    {
      label: "Op insert / sec*",
      value: String(pick(s, "opcounters.insert") ?? "—"),
    },
    {
      label: "Op query / sec*",
      value: String(pick(s, "opcounters.query") ?? "—"),
    },
  ];

  return (
    <WorkspacePage
      title="Server status"
      description="Selected serverStatus() metrics. * counters are cumulative since startup, not per-second."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="border border-border/60 rounded-md p-3"
          >
            <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
              {c.label}
            </div>
            <div className="font-mono text-lg mt-1 tabular-nums">{c.value}</div>
            {c.sub ? (
              <div className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="border border-border/60 rounded-md overflow-hidden">
        <div className="px-3 py-1.5 border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Full serverStatus output
        </div>
        <pre className="bg-zinc-950 text-zinc-100 p-4 font-mono text-[11px] leading-relaxed overflow-auto max-h-[600px] whitespace-pre-wrap break-words">
          {JSON.stringify(s, null, 2)}
        </pre>
      </div>
    </WorkspacePage>
  );
}
