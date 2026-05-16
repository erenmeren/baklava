import { Client } from "@elastic/elasticsearch";
import type { ElasticConfig } from "./types";

function buildAuth(config: ElasticConfig) {
  if (config.apiKey) return { apiKey: config.apiKey };
  if (config.user)
    return { username: config.user, password: config.password ?? "" };
  return undefined;
}

export function createElasticClient(config: ElasticConfig): Client {
  return new Client({
    node: config.nodes,
    auth: buildAuth(config),
    requestTimeout: 5000,
  });
}

export interface ElasticProbeResult {
  name: string;
  clusterName: string;
  version: string;
}

export async function probeElastic(
  config: ElasticConfig
): Promise<ElasticProbeResult> {
  const client = createElasticClient(config);
  try {
    const info = (await client.info()) as unknown as {
      name?: string;
      cluster_name?: string;
      version?: { number?: string };
    };
    return {
      name: info.name ?? "",
      clusterName: info.cluster_name ?? "",
      version: info.version?.number ?? "",
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ElasticTopIndex {
  name: string;
  docCount: number;
  storeSize: number;
}

export interface ElasticOverview {
  version: string;
  clusterName: string;
  nodeName: string;
  status: "green" | "yellow" | "red" | "unknown";
  nodeCount: number;
  totalIndices: number;
  totalDocs: number;
  totalStoreBytes: number;
  jvmHeapUsedBytes: number;
  jvmHeapMaxBytes: number;
  topIndicesByDocs: ElasticTopIndex[];
}

export async function getOverview(
  config: ElasticConfig
): Promise<ElasticOverview> {
  const client = createElasticClient(config);
  try {
    const info = (await client.info()) as unknown as {
      name?: string;
      cluster_name?: string;
      version?: { number?: string };
    };
    const health = (await client.cluster.health()) as unknown as {
      status?: string;
      number_of_nodes?: number;
    };
    const stats = (await client.cluster.stats()) as unknown as {
      indices?: {
        count?: number;
        docs?: { count?: number };
        store?: { size_in_bytes?: number };
      };
      nodes?: {
        count?: { total?: number };
        jvm?: {
          mem?: {
            heap_used_in_bytes?: number;
            heap_max_in_bytes?: number;
          };
        };
      };
    };
    // Top-5 indices by docs.count via cat.indices
    const cat = (await client.cat.indices({
      format: "json",
      bytes: "b",
      h: "index,docs.count,store.size",
    })) as unknown as {
      index?: string;
      "docs.count"?: string;
      "store.size"?: string;
    }[];
    const indices: ElasticTopIndex[] = (Array.isArray(cat) ? cat : []).map(
      (row) => ({
        name: row.index ?? "",
        docCount: Number(row["docs.count"] ?? 0) || 0,
        storeSize: Number(row["store.size"] ?? 0) || 0,
      })
    );
    const topIndicesByDocs = [...indices]
      .sort((a, b) => b.docCount - a.docCount)
      .slice(0, 5);

    const rawStatus = (health.status ?? "").toLowerCase();
    const status: ElasticOverview["status"] =
      rawStatus === "green" || rawStatus === "yellow" || rawStatus === "red"
        ? rawStatus
        : "unknown";

    return {
      version: info.version?.number ?? "",
      clusterName: info.cluster_name ?? "",
      nodeName: info.name ?? "",
      status,
      nodeCount:
        stats.nodes?.count?.total ?? health.number_of_nodes ?? 0,
      totalIndices: stats.indices?.count ?? indices.length,
      totalDocs: stats.indices?.docs?.count ?? 0,
      totalStoreBytes: stats.indices?.store?.size_in_bytes ?? 0,
      jvmHeapUsedBytes: stats.nodes?.jvm?.mem?.heap_used_in_bytes ?? 0,
      jvmHeapMaxBytes: stats.nodes?.jvm?.mem?.heap_max_in_bytes ?? 0,
      topIndicesByDocs,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ElasticIndexSummary {
  name: string;
  health: "green" | "yellow" | "red" | "unknown";
  docCount: number;
  storeSize: number;
  primaries: number;
  replicas: number;
  system: boolean;
}

export async function listIndices(
  config: ElasticConfig
): Promise<ElasticIndexSummary[]> {
  const client = createElasticClient(config);
  try {
    const rows = (await client.cat.indices({
      format: "json",
      bytes: "b",
      h: "index,health,docs.count,store.size,pri,rep",
    })) as unknown as {
      index?: string;
      health?: string;
      "docs.count"?: string;
      "store.size"?: string;
      pri?: string;
      rep?: string;
    }[];

    const list: ElasticIndexSummary[] = (Array.isArray(rows) ? rows : []).map(
      (r) => {
        const name = r.index ?? "";
        const h = (r.health ?? "").toLowerCase();
        const health: ElasticIndexSummary["health"] =
          h === "green" || h === "yellow" || h === "red" ? h : "unknown";
        return {
          name,
          health,
          docCount: Number(r["docs.count"] ?? 0) || 0,
          storeSize: Number(r["store.size"] ?? 0) || 0,
          primaries: Number(r.pri ?? 0) || 0,
          replicas: Number(r.rep ?? 0) || 0,
          system: name.startsWith("."),
        };
      }
    );
    return list.sort((a, b) => b.docCount - a.docCount);
  } finally {
    await client.close().catch(() => undefined);
  }
}
