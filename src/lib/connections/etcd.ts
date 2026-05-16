import { Etcd3 } from "etcd3";
import type { EtcdConfig } from "./types";

function createClient(config: EtcdConfig): Etcd3 {
  const hosts = (config.hosts ?? []).filter(Boolean);
  if (hosts.length === 0) {
    throw new Error("At least one etcd host is required");
  }
  return new Etcd3({
    hosts,
    auth:
      config.user && config.user.length > 0
        ? { username: config.user, password: config.password ?? "" }
        : undefined,
    dialTimeout: 5000,
  });
}

async function withClient<T>(
  config: EtcdConfig,
  fn: (client: Etcd3) => Promise<T>
): Promise<T> {
  const client = createClient(config);
  try {
    return await fn(client);
  } finally {
    try {
      client.close();
    } catch {
      // ignore
    }
  }
}

export interface EtcdProbeResult {
  version: string;
  memberCount: number;
}

export async function probeEtcd(config: EtcdConfig): Promise<EtcdProbeResult> {
  return withClient(config, async (client) => {
    // memberList is a cheap RPC that also returns cluster identity.
    const members = await client.cluster.memberList({});
    // No public "version" RPC, but we can derive it from the maintenance status
    // for the first reachable endpoint. Falls back to "unknown" on failure.
    let version = "unknown";
    try {
      const status = await client.maintenance.status();
      version = status.version || "unknown";
    } catch {
      // ignore — some etcd setups disable maintenance from non-admin auth
    }
    return { version, memberCount: members.members.length };
  });
}

export interface EtcdMemberInfo {
  id: string;
  name: string;
  peerURLs: string[];
  clientURLs: string[];
  isLearner: boolean;
  isLeader: boolean;
}

export interface EtcdOverview {
  version: string;
  cluster: string;
  memberCount: number;
  leaderId: string | null;
  dbSizeBytes: number;
  dbSizeInUseBytes: number;
  raftTerm: string;
  raftIndex: string;
  totalKeys: number;
  members: EtcdMemberInfo[];
}

export async function getEtcdOverview(
  config: EtcdConfig
): Promise<EtcdOverview> {
  return withClient(config, async (client) => {
    const [members, status] = await Promise.all([
      client.cluster.memberList({}),
      client.maintenance.status().catch(() => null),
    ]);

    const leaderId = status?.leader ? String(status.leader) : null;

    // Count keys with a values-less prefix scan over the whole keyspace.
    // getAll().count() returns the total in a single RPC.
    let totalKeys = 0;
    try {
      totalKeys = await client.getAll().count();
    } catch {
      // best-effort
    }

    const memberInfos: EtcdMemberInfo[] = members.members.map((m) => {
      const id = String(m.ID);
      return {
        id,
        name: m.name || "(unnamed)",
        peerURLs: m.peerURLs || [],
        clientURLs: m.clientURLs || [],
        isLearner: Boolean(m.isLearner),
        isLeader: leaderId !== null && id === leaderId,
      };
    });

    return {
      version: status?.version ?? "unknown",
      cluster: members.header?.cluster_id
        ? String(members.header.cluster_id)
        : "",
      memberCount: memberInfos.length,
      leaderId,
      dbSizeBytes: status ? Number(status.dbSize ?? 0) : 0,
      dbSizeInUseBytes: status ? Number(status.dbSizeInUse ?? 0) : 0,
      raftTerm: status?.raftTerm ? String(status.raftTerm) : "0",
      raftIndex: status?.raftIndex ? String(status.raftIndex) : "0",
      totalKeys,
      members: memberInfos,
    };
  });
}

export interface EtcdKeyEntry {
  key: string;
  createRevision: string;
  modRevision: string;
  version: string;
  valueSize: number;
}

export interface EtcdKeyListResult {
  keys: EtcdKeyEntry[];
  total: number;
  limit: number;
  prefix: string;
}

export interface ListEtcdKeysOptions {
  prefix?: string;
  limit?: number;
}

/**
 * List keys under a prefix. We pull the full key metadata (no values) for the
 * requested page so the UI can show createRevision / modRevision per key.
 * etcd3 returns Buffer-typed keys when `.buffers()` is used; using `.keys()`
 * already decodes to strings.
 */
export async function listEtcdKeys(
  config: EtcdConfig,
  opts: ListEtcdKeysOptions = {}
): Promise<EtcdKeyListResult> {
  const prefix = opts.prefix ?? "";
  const limit = Math.max(10, Math.min(1000, opts.limit ?? 100));

  return withClient(config, async (client) => {
    // `.exec()` returns the raw RangeResponse with KeyValue entries (Buffers).
    const query = prefix.length > 0
      ? client.getAll().prefix(prefix)
      : client.getAll();
    const response = await query.limit(limit).exec();

    const keys: EtcdKeyEntry[] = (response.kvs ?? []).map((kv) => ({
      key: kv.key.toString("utf8"),
      createRevision: String(kv.create_revision ?? "0"),
      modRevision: String(kv.mod_revision ?? "0"),
      version: String(kv.version ?? "0"),
      valueSize: kv.value ? kv.value.length : 0,
    }));

    // Separate count query for total — header.count from `.exec()` only
    // returns "count of returned keys" with a limit, not the total. A second
    // RPC is required for an accurate total when paginating.
    let total = keys.length;
    try {
      const countQ = prefix.length > 0
        ? client.getAll().prefix(prefix)
        : client.getAll();
      total = await countQ.count();
    } catch {
      // ignore — some auth setups can't run an unlimited count
    }

    return { keys, total, limit, prefix };
  });
}
