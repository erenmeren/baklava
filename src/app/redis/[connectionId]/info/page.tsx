import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import {
  getSlowlog,
  info,
  listClients,
} from "@/lib/connections/redis";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { InfoClient } from "./info-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function InfoPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<RedisConfig>(connectionId, "redis");
  const result = await Promise.all([
    info(connectionId, record.config).then(
      (sections) => ({ ok: true as const, sections }),
      (err: unknown) => ({ ok: false as const, error: formatError(err) }),
    ),
    listClients(connectionId, record.config).then(
      (clients) => ({ ok: true as const, clients }),
      (err: unknown) => ({ ok: false as const, error: formatError(err) }),
    ),
    getSlowlog(connectionId, record.config, 64).then(
      (entries) => ({ ok: true as const, entries }),
      (err: unknown) => ({ ok: false as const, error: formatError(err) }),
    ),
  ]);
  const [infoRes, clientsRes, slowRes] = result;
  return (
    <WorkspacePage
      title="Info & Clients"
      description="INFO sections, connected clients (CLIENT LIST) and slow query log."
    >
      <InfoClient
        sections={infoRes.ok ? infoRes.sections : {}}
        clients={clientsRes.ok ? clientsRes.clients : []}
        slowlog={slowRes.ok ? slowRes.entries : []}
        errors={[
          !infoRes.ok ? `info: ${infoRes.error}` : null,
          !clientsRes.ok ? `clients: ${clientsRes.error}` : null,
          !slowRes.ok ? `slowlog: ${slowRes.error}` : null,
        ].filter((x): x is string => x !== null)}
      />
    </WorkspacePage>
  );
}
