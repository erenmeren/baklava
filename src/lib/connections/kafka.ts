import {
  Kafka,
  logLevel,
  ConfigResourceTypes,
  type SASLOptions,
  type ITopicConfig,
  type Consumer,
} from "kafkajs";
import type { KafkaConfig } from "./types";

export function createKafkaClient(config: KafkaConfig): Kafka {
  let sasl: SASLOptions | undefined;
  if (config.sasl) {
    const { username, password, mechanism } = config.sasl;
    if (mechanism === "plain") {
      sasl = { mechanism: "plain", username, password };
    } else if (mechanism === "scram-sha-256") {
      sasl = { mechanism: "scram-sha-256", username, password };
    } else {
      sasl = { mechanism: "scram-sha-512", username, password };
    }
  }
  return new Kafka({
    clientId: config.clientId || "baklava",
    brokers: config.brokers,
    ssl: config.ssl,
    sasl,
    logLevel: logLevel.ERROR,
    connectionTimeout: 5000,
    requestTimeout: 8000,
  });
}

export interface KafkaTopicSummary {
  name: string;
  partitions: number;
  replicas: number;
  internal: boolean;
}

export async function listTopics(
  config: KafkaConfig
): Promise<KafkaTopicSummary[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const metadata = await admin.fetchTopicMetadata();
    return metadata.topics
      .map((t) => ({
        name: t.name,
        partitions: t.partitions.length,
        replicas: t.partitions[0]?.replicas?.length ?? 0,
        internal: t.name.startsWith("__"),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface KafkaProbeResult {
  topics: KafkaTopicSummary[];
  brokerCount: number;
}

export async function probeKafka(config: KafkaConfig): Promise<KafkaProbeResult> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const cluster = await admin.describeCluster();
    const metadata = await admin.fetchTopicMetadata();
    const topics: KafkaTopicSummary[] = metadata.topics
      .filter((t) => !t.name.startsWith("__"))
      .map((t) => ({
        name: t.name,
        partitions: t.partitions.length,
        replicas: t.partitions[0]?.replicas?.length ?? 0,
        internal: false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { topics, brokerCount: cluster.brokers.length };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export async function createTopic(
  config: KafkaConfig,
  name: string,
  partitions: number,
  replicationFactor: number
): Promise<void> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const topic: ITopicConfig = {
      topic: name,
      numPartitions: partitions,
      replicationFactor,
    };
    await admin.createTopics({ topics: [topic], waitForLeaders: true });
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export async function deleteTopic(
  config: KafkaConfig,
  name: string
): Promise<void> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    await admin.deleteTopics({ topics: [name] });
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface TopicDetail {
  name: string;
  partitions: {
    partition: number;
    leader: number;
    replicas: number[];
    isr: number[];
    high: string;
    low: string;
  }[];
  configs: { name: string; value: string; isDefault: boolean }[];
}

export async function describeTopic(
  config: KafkaConfig,
  name: string
): Promise<TopicDetail> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const metadata = await admin.fetchTopicMetadata({ topics: [name] });
    const t = metadata.topics[0];
    if (!t) throw new Error("Topic not found");
    const offsets = await admin.fetchTopicOffsets(name);
    const offsetByPartition = new Map<
      number,
      { high: string; low: string }
    >();
    for (const o of offsets) {
      offsetByPartition.set(o.partition, { high: o.high, low: o.low });
    }
    const configs = await admin.describeConfigs({
      includeSynonyms: false,
      resources: [{ type: 2, name }],
    });
    const entries = configs.resources[0]?.configEntries ?? [];
    return {
      name,
      partitions: t.partitions.map((p) => ({
        partition: p.partitionId,
        leader: p.leader,
        replicas: p.replicas,
        isr: p.isr,
        high: offsetByPartition.get(p.partitionId)?.high ?? "0",
        low: offsetByPartition.get(p.partitionId)?.low ?? "0",
      })),
      configs: entries.map((e) => ({
        name: e.configName,
        value: e.configValue,
        isDefault: Boolean(
          (e as unknown as { isDefault?: boolean; configSource?: number })
            .isDefault ??
            (e as unknown as { configSource?: number }).configSource === 5
        ),
      })),
    };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface KafkaMessage {
  partition: number;
  offset: string;
  timestamp: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

export async function fetchMessages(
  config: KafkaConfig,
  topic: string,
  options: { partition?: number; limit: number; fromBeginning: boolean }
): Promise<KafkaMessage[]> {
  const client = createKafkaClient(config);
  const groupId = `baklava-browse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const consumer = client.consumer({
    groupId,
    sessionTimeout: 10000,
    heartbeatInterval: 3000,
  });
  await consumer.connect();
  try {
    await consumer.subscribe({ topic, fromBeginning: options.fromBeginning });
    const collected: KafkaMessage[] = [];
    const target = options.limit;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      consumer
        .run({
          autoCommit: false,
          eachMessage: async ({ partition, message }) => {
            if (
              options.partition != null &&
              partition !== options.partition
            ) {
              return;
            }
            const headers: Record<string, string> = {};
            if (message.headers) {
              for (const [k, v] of Object.entries(message.headers)) {
                if (v == null) headers[k] = "";
                else if (Buffer.isBuffer(v)) headers[k] = v.toString("utf8");
                else if (typeof v === "string") headers[k] = v;
                else if (Array.isArray(v))
                  headers[k] = v
                    .map((p) =>
                      Buffer.isBuffer(p) ? p.toString("utf8") : String(p)
                    )
                    .join(",");
                else headers[k] = String(v);
              }
            }
            collected.push({
              partition,
              offset: message.offset,
              timestamp: message.timestamp,
              key: message.key ? message.key.toString("utf8") : null,
              value: message.value ? message.value.toString("utf8") : null,
              headers,
            });
            if (collected.length >= target) {
              clearTimeout(timer);
              resolve();
            }
          },
        })
        .catch(() => {
          clearTimeout(timer);
          resolve();
        });
    });
    return collected.slice(0, target);
  } finally {
    await consumer.disconnect().catch(() => undefined);
    try {
      const admin = client.admin();
      await admin.connect();
      try {
        await admin.deleteGroups([groupId]);
      } finally {
        await admin.disconnect().catch(() => undefined);
      }
    } catch (err) {
      console.warn("fetchMessages: failed to delete consumer group", err);
    }
  }
}

export async function produceMessage(
  config: KafkaConfig,
  topic: string,
  payload: { key?: string; value: string; headers?: Record<string, string> }
): Promise<void> {
  const client = createKafkaClient(config);
  const producer = client.producer();
  await producer.connect();
  try {
    await producer.send({
      topic,
      messages: [
        {
          key: payload.key ?? null,
          value: payload.value,
          headers: payload.headers,
        },
      ],
    });
  } finally {
    await producer.disconnect().catch(() => undefined);
  }
}

export interface ConsumerGroupSummary {
  groupId: string;
  protocolType: string;
  state?: string;
}

export async function listConsumerGroups(
  config: KafkaConfig
): Promise<ConsumerGroupSummary[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const list = await admin.listGroups();
    if (list.groups.length === 0) return [];
    const desc = await admin.describeGroups(list.groups.map((g) => g.groupId));
    const stateById = new Map(desc.groups.map((g) => [g.groupId, g.state]));
    return list.groups.map((g) => ({
      groupId: g.groupId,
      protocolType: g.protocolType,
      state: stateById.get(g.groupId),
    }));
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface ConsumerGroupDetail {
  groupId: string;
  state: string;
  members: {
    memberId: string;
    clientId: string;
    clientHost: string;
  }[];
  offsets: {
    topic: string;
    partition: number;
    offset: string;
    high: string;
    lag: number;
  }[];
}

export async function describeConsumerGroup(
  config: KafkaConfig,
  groupId: string
): Promise<ConsumerGroupDetail> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    // Run describeGroups + fetchOffsets in parallel. Crucially we do NOT pass
    // resolveOffsets:true — that triggers a per-group temporary consumer join
    // inside kafkajs and can take 5+ seconds per group. Instead we fetch the
    // high-water-marks separately via fetchTopicOffsets (admin RPC, no join).
    const [desc, offsetsRaw] = await Promise.all([
      admin.describeGroups([groupId]),
      admin.fetchOffsets({ groupId }),
    ]);
    const g = desc.groups[0];
    const topics = [...new Set(offsetsRaw.map((t) => t.topic))];
    const highWaterMarks = await Promise.all(
      topics.map((t) =>
        admin
          .fetchTopicOffsets(t)
          .then((rows) => ({ topic: t, rows }))
          .catch(() => ({ topic: t, rows: [] as never[] }))
      )
    );
    const highByTopicPartition = new Map<string, string>();
    for (const { topic, rows } of highWaterMarks) {
      for (const r of rows) {
        highByTopicPartition.set(`${topic}/${r.partition}`, r.high);
      }
    }

    const offsets: ConsumerGroupDetail["offsets"] = [];
    for (const t of offsetsRaw) {
      for (const p of t.partitions) {
        const high =
          highByTopicPartition.get(`${t.topic}/${p.partition}`) ?? "-1";
        const off = p.offset;
        const offNum = Number(off);
        const highNum = Number(high);
        offsets.push({
          topic: t.topic,
          partition: p.partition,
          offset: off,
          high,
          lag: highNum >= 0 && offNum >= 0 ? Math.max(0, highNum - offNum) : 0,
        });
      }
    }
    return {
      groupId,
      state: g.state,
      members: g.members.map((m) => ({
        memberId: m.memberId,
        clientId: m.clientId,
        clientHost: m.clientHost,
      })),
      offsets,
    };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface BrokerInfo {
  nodeId: number;
  host: string;
  port: number;
  rack?: string;
  isController: boolean;
}

export async function listBrokers(config: KafkaConfig): Promise<BrokerInfo[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const cluster = await admin.describeCluster();
    return cluster.brokers.map((b) => ({
      nodeId: b.nodeId,
      host: b.host,
      port: b.port,
      isController: b.nodeId === cluster.controller,
    }));
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export async function alterTopicConfig(
  config: KafkaConfig,
  topic: string,
  entries: { name: string; value: string }[]
): Promise<void> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    await admin.alterConfigs({
      validateOnly: false,
      resources: [
        {
          type: ConfigResourceTypes.TOPIC,
          name: topic,
          configEntries: entries.map((e) => ({ name: e.name, value: e.value })),
        },
      ],
    });
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export async function addTopicPartitions(
  config: KafkaConfig,
  topic: string,
  totalPartitions: number
): Promise<void> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    await admin.createPartitions({
      topicPartitions: [{ topic, count: totalPartitions }],
    });
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export async function emptyTopic(
  config: KafkaConfig,
  topic: string
): Promise<void> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const meta = await admin.fetchTopicMetadata({ topics: [topic] });
    const t = meta.topics[0];
    if (!t) throw new Error("Topic not found");
    const partitions = t.partitions.length;
    const replicationFactor = t.partitions[0]?.replicas?.length ?? 1;
    await admin.deleteTopics({ topics: [topic] });
    // small delay so brokers settle the deletion before recreate
    await new Promise((r) => setTimeout(r, 500));
    await admin.createTopics({
      waitForLeaders: true,
      topics: [
        { topic, numPartitions: partitions, replicationFactor } satisfies ITopicConfig,
      ],
    });
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface TailMessage {
  partition: number;
  offset: string;
  timestamp: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

export interface TailHandle {
  stop: () => Promise<void>;
}

function decodeHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (v == null) out[k] = "";
    else if (Buffer.isBuffer(v)) out[k] = v.toString("utf8");
    else if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v))
      out[k] = v
        .map((p) => (Buffer.isBuffer(p) ? p.toString("utf8") : String(p)))
        .join(",");
    else out[k] = String(v);
  }
  return out;
}

export async function startMessageTail(
  config: KafkaConfig,
  opts: { topic: string; fromBeginning?: boolean; partition?: number },
  onMessage: (m: TailMessage) => void,
  onError: (err: unknown) => void
): Promise<TailHandle> {
  const client = createKafkaClient(config);
  const groupId = `baklava-tail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const consumer: Consumer = client.consumer({
    groupId,
    sessionTimeout: 10000,
    heartbeatInterval: 3000,
  });
  await consumer.connect();
  await consumer.subscribe({
    topic: opts.topic,
    fromBeginning: Boolean(opts.fromBeginning),
  });
  consumer
    .run({
      autoCommit: false,
      eachMessage: async ({ partition, message }) => {
        if (opts.partition != null && partition !== opts.partition) return;
        onMessage({
          partition,
          offset: message.offset,
          timestamp: message.timestamp,
          key: message.key ? message.key.toString("utf8") : null,
          value: message.value ? message.value.toString("utf8") : null,
          headers: decodeHeaders(message.headers),
        });
      },
    })
    .catch((err) => onError(err));

  return {
    stop: async () => {
      await consumer.disconnect().catch(() => undefined);
      try {
        const admin = client.admin();
        await admin.connect();
        try {
          await admin.deleteGroups([groupId]);
        } finally {
          await admin.disconnect().catch(() => undefined);
        }
      } catch (err) {
        console.warn("startMessageTail: failed to delete consumer group", err);
      }
    },
  };
}

export type ResetOffsetTarget =
  | { kind: "earliest" }
  | { kind: "latest" }
  | { kind: "timestamp"; timestamp: number }
  | { kind: "offset"; offset: string };

/**
 * Returns the current state of a consumer group, or null if it doesn't exist.
 * Used as a pre-flight check before reset operations so we can surface a
 * friendly error instead of letting the broker reject the request.
 */
export async function getConsumerGroupState(
  config: KafkaConfig,
  groupId: string
): Promise<string | null> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const desc = await admin.describeGroups([groupId]);
    return desc.groups[0]?.state ?? null;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

/**
 * Commit explicit offsets for a group + topic by briefly joining the group as
 * a consumer, committing, then sending LeaveGroup on disconnect.
 *
 * Why not `admin.setOffsets()`? kafkajs's admin.setOffsets internally spins up
 * a Consumer to join the group, but doesn't reliably send LeaveGroup on
 * disconnect — phantom members accumulate every call. Managing the consumer
 * lifecycle ourselves guarantees the group transitions back to Empty within
 * a couple seconds.
 */
async function commitGroupOffsetsClean(
  config: KafkaConfig,
  groupId: string,
  topic: string,
  partitionEntries: { partition: number; offset: string }[]
): Promise<void> {
  if (partitionEntries.length === 0) return;
  const client = createKafkaClient(config);
  const consumer = client.consumer({
    groupId,
    sessionTimeout: 10_000,
    heartbeatInterval: 3_000,
  });
  let connected = false;
  let running = false;
  try {
    await consumer.connect();
    connected = true;
    await consumer.subscribe({ topic, fromBeginning: false });
    // Start the runner so we join the group and receive an assignment.
    // eachMessage is a no-op — we don't actually want to consume anything.
    await consumer.run({ autoCommit: false, eachMessage: async () => {} });
    running = true;
    // Wait for the group join + assignment to settle.
    await new Promise((r) => setTimeout(r, 1500));
    await consumer.commitOffsets(
      partitionEntries.map((p) => ({
        topic,
        partition: p.partition,
        offset: p.offset,
      }))
    );
  } finally {
    if (running) await consumer.stop().catch(() => undefined);
    if (connected) await consumer.disconnect().catch(() => undefined);
  }
}

export async function resetGroupOffsets(
  config: KafkaConfig,
  groupId: string,
  topic: string,
  target: ResetOffsetTarget,
  partitions?: number[]
): Promise<void> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    if (target.kind === "earliest" || target.kind === "latest") {
      // admin.resetOffsets uses the broker's reset RPC — no consumer join,
      // no phantom members. Requires the group to be Empty (broker-enforced).
      await admin.resetOffsets({
        groupId,
        topic,
        earliest: target.kind === "earliest",
      });
      return;
    }

    // For timestamp / explicit-offset, resolve the target offsets first,
    // then commit via a properly-managed consumer (not admin.setOffsets).
    let entries: { partition: number; offset: string }[];
    if (target.kind === "timestamp") {
      const result = await admin.fetchTopicOffsetsByTimestamp(
        topic,
        target.timestamp
      );
      entries = result
        .filter((p) => !partitions || partitions.includes(p.partition))
        .map((p) => ({ partition: p.partition, offset: p.offset }));
    } else {
      const meta = await admin.fetchTopicMetadata({ topics: [topic] });
      const t = meta.topics[0];
      if (!t) throw new Error("Topic not found");
      const allPartitions = t.partitions.map((p) => p.partitionId);
      entries = (partitions ?? allPartitions).map((p) => ({
        partition: p,
        offset: target.offset,
      }));
    }

    // Release the admin connection before joining as a consumer.
    await admin.disconnect().catch(() => undefined);
    await commitGroupOffsetsClean(config, groupId, topic, entries);
    return;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export async function deleteConsumerGroup(
  config: KafkaConfig,
  groupId: string
): Promise<void> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    await admin.deleteGroups([groupId]);
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats helpers (cluster overview / dense lists)
// ─────────────────────────────────────────────────────────────────────────────

export interface KafkaClusterSummary {
  brokers: BrokerInfo[];
  controllerId: number | null;
  userTopicCount: number;
  internalTopicCount: number;
  totalPartitions: number;
  underReplicatedPartitions: number;
  underReplicatedTopics: string[];
  consumerGroupCount: number;
  groupStates: Record<string, number>;
  totalMessages: number;
  topTopicsByVolume: { name: string; messages: number }[];
}

export async function getClusterSummary(
  config: KafkaConfig
): Promise<KafkaClusterSummary> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const [cluster, metadata, groupList] = await Promise.all([
      admin.describeCluster(),
      admin.fetchTopicMetadata(),
      admin.listGroups(),
    ]);

    let totalPartitions = 0;
    let underReplicatedPartitions = 0;
    const underReplicatedTopics = new Set<string>();
    let userTopicCount = 0;
    let internalTopicCount = 0;

    for (const t of metadata.topics) {
      const internal = t.name.startsWith("__");
      if (internal) internalTopicCount += 1;
      else userTopicCount += 1;
      totalPartitions += t.partitions.length;
      for (const p of t.partitions) {
        if (p.isr.length < p.replicas.length) {
          underReplicatedPartitions += 1;
          underReplicatedTopics.add(t.name);
        }
      }
    }

    // Per-topic message totals (sum high-low across partitions). Run in parallel.
    const offsetResults = await Promise.all(
      metadata.topics.map((t) =>
        admin
          .fetchTopicOffsets(t.name)
          .then((rows) => ({ name: t.name, rows }))
          .catch(() => ({ name: t.name, rows: [] as never[] }))
      )
    );

    let totalMessages = 0;
    const perTopicMessages = new Map<string, number>();
    for (const { name, rows } of offsetResults) {
      let sum = 0;
      for (const r of rows) {
        const h = Number(r.high);
        const l = Number(r.low);
        if (Number.isFinite(h) && Number.isFinite(l)) sum += Math.max(0, h - l);
      }
      perTopicMessages.set(name, sum);
      totalMessages += sum;
    }

    const topTopicsByVolume = [...perTopicMessages.entries()]
      .filter(([name]) => !name.startsWith("__"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, messages]) => ({ name, messages }));

    // Group state breakdown (best-effort; describeGroups may be expensive).
    const groupStates: Record<string, number> = {};
    if (groupList.groups.length > 0) {
      try {
        const desc = await admin.describeGroups(
          groupList.groups.map((g) => g.groupId)
        );
        for (const g of desc.groups) {
          const s = g.state || "Unknown";
          groupStates[s] = (groupStates[s] || 0) + 1;
        }
      } catch {
        // ignore
      }
    }

    return {
      brokers: cluster.brokers.map((b) => ({
        nodeId: b.nodeId,
        host: b.host,
        port: b.port,
        isController: b.nodeId === cluster.controller,
      })),
      controllerId: cluster.controller ?? null,
      userTopicCount,
      internalTopicCount,
      totalPartitions,
      underReplicatedPartitions,
      underReplicatedTopics: [...underReplicatedTopics].sort(),
      consumerGroupCount: groupList.groups.length,
      groupStates,
      totalMessages,
      topTopicsByVolume,
    };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface KafkaTopicStat extends KafkaTopicSummary {
  messages: number;
  underReplicated: boolean;
  partitionCounts: number[];
}

export async function listTopicsWithStats(
  config: KafkaConfig
): Promise<KafkaTopicStat[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const metadata = await admin.fetchTopicMetadata();
    const offsetResults = await Promise.all(
      metadata.topics.map((t) =>
        admin
          .fetchTopicOffsets(t.name)
          .then((rows) => ({ name: t.name, rows }))
          .catch(() => ({ name: t.name, rows: [] as never[] }))
      )
    );
    const offsetsByTopic = new Map(
      offsetResults.map(({ name, rows }) => [name, rows])
    );

    return metadata.topics
      .map<KafkaTopicStat>((t) => {
        const rows = offsetsByTopic.get(t.name) ?? [];
        const partitionCounts: number[] = [];
        let total = 0;
        for (const r of rows) {
          const h = Number(r.high);
          const l = Number(r.low);
          const c = Number.isFinite(h) && Number.isFinite(l) ? Math.max(0, h - l) : 0;
          partitionCounts.push(c);
          total += c;
        }
        const underReplicated = t.partitions.some(
          (p) => p.isr.length < p.replicas.length
        );
        return {
          name: t.name,
          partitions: t.partitions.length,
          replicas: t.partitions[0]?.replicas?.length ?? 0,
          internal: t.name.startsWith("__"),
          messages: total,
          underReplicated,
          partitionCounts,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface KafkaGroupStat extends ConsumerGroupSummary {
  memberCount: number;
  topicCount: number;
  totalLag: number;
}

export async function listConsumerGroupsWithLag(
  config: KafkaConfig
): Promise<KafkaGroupStat[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const list = await admin.listGroups();
    if (list.groups.length === 0) return [];

    const groupIds = list.groups.map((g) => g.groupId);
    const desc = await admin.describeGroups(groupIds);
    const memberInfo = new Map<
      string,
      { state: string; memberCount: number }
    >();
    for (const g of desc.groups) {
      memberInfo.set(g.groupId, {
        state: g.state,
        memberCount: g.members.length,
      });
    }

    // Fetch committed offsets per group (WITHOUT resolveOffsets:true — that
    // would trigger a temporary consumer join inside kafkajs costing 5+ s
    // per group). High-water-marks are fetched separately, deduplicated by
    // topic, so groups that share a topic only pay the cost once.
    const groupOffsets = await Promise.all(
      groupIds.map((groupId) =>
        admin
          .fetchOffsets({ groupId })
          .then((rows) => ({ groupId, rows }))
          .catch(() => ({ groupId, rows: [] as never[] }))
      )
    );

    const allTopics = new Set<string>();
    for (const { rows } of groupOffsets) {
      for (const t of rows) allTopics.add(t.topic);
    }
    const highWaterMarks = await Promise.all(
      [...allTopics].map((t) =>
        admin
          .fetchTopicOffsets(t)
          .then((rows) => ({ topic: t, rows }))
          .catch(() => ({ topic: t, rows: [] as never[] }))
      )
    );
    const highByTopicPartition = new Map<string, number>();
    for (const { topic, rows } of highWaterMarks) {
      for (const r of rows) {
        highByTopicPartition.set(`${topic}/${r.partition}`, Number(r.high));
      }
    }

    return list.groups
      .map((g) => {
        const info = memberInfo.get(g.groupId);
        const rows =
          groupOffsets.find((o) => o.groupId === g.groupId)?.rows ?? [];
        const topics = new Set<string>();
        let totalLag = 0;
        for (const t of rows) {
          topics.add(t.topic);
          for (const p of t.partitions) {
            const high =
              highByTopicPartition.get(`${t.topic}/${p.partition}`) ?? -1;
            const off = Number(p.offset);
            if (high >= 0 && off >= 0) totalLag += Math.max(0, high - off);
          }
        }
        return {
          groupId: g.groupId,
          protocolType: g.protocolType,
          state: info?.state,
          memberCount: info?.memberCount ?? 0,
          topicCount: topics.size,
          totalLag,
        };
      })
      .sort((a, b) => b.totalLag - a.totalLag);
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}
