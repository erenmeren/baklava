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
    const desc = await admin.describeGroups([groupId]);
    const g = desc.groups[0];
    const offsetsRaw = await admin.fetchOffsets({ groupId, resolveOffsets: true });
    const offsets: ConsumerGroupDetail["offsets"] = [];
    for (const t of offsetsRaw) {
      for (const p of t.partitions) {
        const high = (p as unknown as { high?: string }).high ?? "-1";
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
      // resetOffsets requires the group to be empty
      await admin.resetOffsets({
        groupId,
        topic,
        earliest: target.kind === "earliest",
      });
    } else if (target.kind === "timestamp") {
      const result = await admin.fetchTopicOffsetsByTimestamp(
        topic,
        target.timestamp
      );
      const entries = result
        .filter(
          (p) => !partitions || partitions.includes(p.partition)
        )
        .map((p) => ({ partition: p.partition, offset: p.offset }));
      if (entries.length > 0) {
        await admin.setOffsets({ groupId, topic, partitions: entries });
      }
    } else {
      // specific offset
      const meta = await admin.fetchTopicMetadata({ topics: [topic] });
      const t = meta.topics[0];
      if (!t) throw new Error("Topic not found");
      const allPartitions = t.partitions.map((p) => p.partitionId);
      const targets = (partitions ?? allPartitions).map((p) => ({
        partition: p,
        offset: target.offset,
      }));
      await admin.setOffsets({ groupId, topic, partitions: targets });
    }
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
