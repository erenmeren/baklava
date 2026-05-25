import {
  Kafka,
  logLevel,
  ConfigResourceTypes,
  type SASLOptions,
  type ITopicConfig,
  type Consumer,
} from "kafkajs";
import type { KafkaConfig } from "./types";
import type { SchemaRegistryClient } from "./kafka-schema-registry";

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

export interface DecodedPayloadView {
  schemaId: number;
  schemaType: "AVRO" | "JSON" | "PROTOBUF";
  subject: string | null;
  version: number | null;
  /** Decoded payload serialized as a JSON string (so the wire stays JSON). */
  json: string | null;
  note?: string;
}

export interface KafkaMessage {
  partition: number;
  offset: string;
  timestamp: string;
  /** UTF-8 view of the key — may be garbled for binary keys. */
  key: string | null;
  /** Base64 view of the raw key bytes — preserved losslessly. */
  keyBase64: string | null;
  /** UTF-8 view of the value — only useful for plain-text payloads. */
  value: string | null;
  /** Base64 view of the raw value bytes — preserved losslessly. */
  valueBase64: string | null;
  /** Populated when a Confluent magic byte was sniffed and SR decoded the payload. */
  valueDecoded?: DecodedPayloadView;
  headers: Record<string, string>;
}

/** Helper: turn a kafkajs Buffer into the new dual key/value shape. */
async function materializeMessage(args: {
  partition: number;
  offset: string;
  timestamp: string;
  key: Buffer | null;
  value: Buffer | null;
  headers: Record<string, string>;
  schemaRegistry?: SchemaRegistryClient | null;
}): Promise<KafkaMessage> {
  const { partition, offset, timestamp, key, value, headers, schemaRegistry } =
    args;
  let valueDecoded: DecodedPayloadView | undefined;
  if (schemaRegistry && value && value.length > 5 && value[0] === 0x00) {
    try {
      const dec = await schemaRegistry.decode(value);
      if (dec) {
        valueDecoded = {
          schemaId: dec.schemaId,
          schemaType: dec.schemaType,
          subject: dec.subject,
          version: dec.version,
          json:
            dec.decoded === null
              ? null
              : JSON.stringify(dec.decoded, (_k, v) =>
                  typeof v === "bigint" ? v.toString() : v,
                ),
          note: dec.note,
        };
      }
    } catch (err) {
      valueDecoded = {
        schemaId: -1,
        schemaType: "AVRO",
        subject: null,
        version: null,
        json: null,
        note: `Schema Registry decode failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  return {
    partition,
    offset,
    timestamp,
    key: key ? key.toString("utf8") : null,
    keyBase64: key ? key.toString("base64") : null,
    value: value ? value.toString("utf8") : null,
    valueBase64: value ? value.toString("base64") : null,
    valueDecoded,
    headers,
  };
}

export async function fetchMessages(
  config: KafkaConfig,
  topic: string,
  options: {
    partition?: number;
    limit: number;
    fromBeginning: boolean;
    schemaRegistry?: SchemaRegistryClient | null;
  },
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
            const headers = decodeHeaders(message.headers);
            collected.push(
              await materializeMessage({
                partition,
                offset: message.offset,
                timestamp: message.timestamp,
                key: message.key,
                value: message.value,
                headers,
                schemaRegistry: options.schemaRegistry,
              }),
            );
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

/**
 * Fetch up to `limit` messages from `(partition, offset)` — used by the
 * "jump to offset" UI on the messages tab. Uses an ephemeral consumer
 * group so the broker doesn't track the seek state.
 */
export async function fetchMessagesFromOffset(
  config: KafkaConfig,
  topic: string,
  partition: number,
  startOffset: string,
  limit: number,
  schemaRegistry?: SchemaRegistryClient | null,
): Promise<KafkaMessage[]> {
  const client = createKafkaClient(config);
  const groupId = `baklava-seek-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const consumer = client.consumer({
    groupId,
    sessionTimeout: 10_000,
    heartbeatInterval: 3_000,
  });
  await consumer.connect();
  try {
    await consumer.subscribe({ topic, fromBeginning: false });
    const collected: KafkaMessage[] = [];
    let seeked = false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 6_000);
      consumer
        .run({
          autoCommit: false,
          eachMessage: async ({ partition: p, message }) => {
            if (p !== partition) return;
            collected.push(
              await materializeMessage({
                partition: p,
                offset: message.offset,
                timestamp: message.timestamp,
                key: message.key,
                value: message.value,
                headers: decodeHeaders(message.headers),
                schemaRegistry,
              }),
            );
            if (collected.length >= limit) {
              clearTimeout(timer);
              resolve();
            }
          },
        })
        .catch(() => {
          clearTimeout(timer);
          resolve();
        });
      // kafkajs assigns partitions asynchronously after run() — wait a
      // beat, then seek. If we seek too early the assignment isn't ready.
      const trySeek = () => {
        if (seeked) return;
        try {
          consumer.seek({ topic, partition, offset: startOffset });
          seeked = true;
        } catch {
          setTimeout(trySeek, 100);
        }
      };
      setTimeout(trySeek, 500);
    });
    return collected.slice(0, limit);
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
      console.warn("fetchMessagesFromOffset: failed to delete consumer group", err);
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

export interface ReplayInput {
  /** Source topic (probably a DLQ). */
  sourceTopic: string;
  /** Target topic — defaults to header `x-original-topic` per-message when omitted. */
  targetTopic?: string;
  /** Specific (partition, offset) pairs to replay. */
  picks: Array<{ partition: number; offset: string }>;
  /** Strip headers matching these prefixes (e.g. "kafka_" or "x-exception"). */
  stripHeaderPrefixes?: string[];
  /** When true, only count what would be sent — don't actually produce. */
  dryRun?: boolean;
}

export interface ReplayResult {
  scanned: number;
  sent: number;
  skipped: Array<{ partition: number; offset: string; reason: string }>;
}

/**
 * Replays specific DLQ messages back to an inferred or explicit target.
 *
 * Strategy: for each (partition, offset) we want to replay, briefly join
 * an ephemeral consumer group, seek, read exactly one message, then
 * produce it to the target topic preserving key + headers (modulo any
 * stripped header prefixes). The target is either the explicit
 * `targetTopic`, the value of the `x-original-topic` header, or — failing
 * both — derived by trimming the most common DLQ suffixes from the source.
 */
export async function replayDeadLetters(
  config: KafkaConfig,
  input: ReplayInput,
): Promise<ReplayResult> {
  const sourceTopic = input.sourceTopic;
  const strips = input.stripHeaderPrefixes ?? [];
  const scanned = 0;
  let sent = 0;
  const skipped: ReplayResult["skipped"] = [];

  const inferTarget = (
    headers: Record<string, string>,
    fallbackSource: string,
  ): string | null => {
    if (input.targetTopic) return input.targetTopic;
    const hint =
      headers["x-original-topic"] ??
      headers["kafka_originalTopic"] ??
      headers["x_original_topic"];
    if (hint) return hint;
    // Strip common DLQ suffixes if present.
    const suffixes = [".DLQ", ".dlt", "-DLQ", "-dlt", "_dlq", "_DLQ", ".dlq"];
    for (const s of suffixes) {
      if (fallbackSource.endsWith(s)) return fallbackSource.slice(0, -s.length);
    }
    return null;
  };

  const client = createKafkaClient(config);
  const producer = client.producer();
  await producer.connect();

  try {
    // Read each pick by spinning up a one-shot consumer per pick. Costly,
    // but DLQ replays are usually low-volume and this keeps the code
    // straightforward and correct.
    for (const pick of input.picks) {
      const messages = await fetchMessagesFromOffset(
        config,
        sourceTopic,
        pick.partition,
        pick.offset,
        1,
      );
      if (messages.length === 0) {
        skipped.push({
          partition: pick.partition,
          offset: pick.offset,
          reason: "not found",
        });
        continue;
      }
      const m = messages[0];
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.headers)) {
        if (strips.some((p) => k.startsWith(p))) continue;
        headers[k] = v;
      }
      const target = inferTarget(m.headers, sourceTopic);
      if (!target) {
        skipped.push({
          partition: pick.partition,
          offset: pick.offset,
          reason: "no target topic could be inferred",
        });
        continue;
      }
      if (input.dryRun) {
        sent += 1;
        continue;
      }
      await producer.send({
        topic: target,
        messages: [
          {
            key: m.key,
            value: m.value ?? null,
            headers,
          },
        ],
      });
      sent += 1;
    }
  } finally {
    await producer.disconnect().catch(() => undefined);
  }

  return { scanned, sent, skipped };
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

export interface ConsumerGroupMemberAssignment {
  topic: string;
  partitions: number[];
}

export interface ConsumerGroupMember {
  memberId: string;
  clientId: string;
  clientHost: string;
  /** Partitions this member is assigned. Decoded from kafkajs MemberAssignment. */
  assignments: ConsumerGroupMemberAssignment[];
  /** Total partition count across all topics (cached for at-a-glance display). */
  partitionCount: number;
}

export interface ConsumerGroupOffset {
  topic: string;
  partition: number;
  offset: string;
  high: string;
  lag: number;
  /** memberId of the member currently consuming this partition, if any. */
  ownerMemberId?: string;
  /** clientId of the owner — convenience for display. */
  ownerClientId?: string;
}

export interface ConsumerGroupDetail {
  groupId: string;
  state: string;
  protocolType?: string;
  protocol?: string;
  members: ConsumerGroupMember[];
  offsets: ConsumerGroupOffset[];
}

function decodeMemberAssignment(buf: Buffer): ConsumerGroupMemberAssignment[] {
  if (!buf || buf.length === 0) return [];
  try {
    // kafkajs exports the binary codec for the consumer protocol's
    // memberAssignment Buffer.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AssignerProtocol } = require("kafkajs") as typeof import("kafkajs");
    const decoded = AssignerProtocol.MemberAssignment.decode(buf);
    if (!decoded) return [];
    return Object.entries(decoded.assignment).map(([topic, partitions]) => ({
      topic,
      partitions: [...(partitions as number[])].sort((a, b) => a - b),
    }));
  } catch {
    return [];
  }
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

    // Decode assignments once per member, then build an owner index keyed
    // by topic/partition so we can stamp every offset row with its owner.
    const enrichedMembers: ConsumerGroupMember[] = g.members.map((m) => {
      const assignments = decodeMemberAssignment(
        (m as unknown as { memberAssignment?: Buffer }).memberAssignment ??
          Buffer.alloc(0),
      );
      const partitionCount = assignments.reduce(
        (s, a) => s + a.partitions.length,
        0,
      );
      return {
        memberId: m.memberId,
        clientId: m.clientId,
        clientHost: m.clientHost,
        assignments,
        partitionCount,
      };
    });
    const ownerIndex = new Map<string, { memberId: string; clientId: string }>();
    for (const m of enrichedMembers) {
      for (const a of m.assignments) {
        for (const p of a.partitions) {
          ownerIndex.set(`${a.topic}/${p}`, {
            memberId: m.memberId,
            clientId: m.clientId,
          });
        }
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
        const owner = ownerIndex.get(`${t.topic}/${p.partition}`);
        offsets.push({
          topic: t.topic,
          partition: p.partition,
          offset: off,
          high,
          lag: highNum >= 0 && offNum >= 0 ? Math.max(0, highNum - offNum) : 0,
          ownerMemberId: owner?.memberId,
          ownerClientId: owner?.clientId,
        });
      }
    }
    return {
      groupId,
      state: g.state,
      protocolType: g.protocolType,
      protocol: g.protocol,
      members: enrichedMembers,
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
  /** Total bytes written to any log dir on this broker. */
  totalLogBytes?: number;
  /** Total number of partition replicas (leader + follower) hosted here. */
  partitionCount?: number;
  /** Number of partitions for which this broker is leader. */
  leaderCount?: number;
}

/**
 * Lists brokers and (when admin permissions allow) joins on log-dir size +
 * leader / replica counts from the cluster metadata. Failures in the
 * enrichment steps degrade gracefully — the base broker list still returns.
 */
export async function listBrokers(config: KafkaConfig): Promise<BrokerInfo[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const cluster = await admin.describeCluster();
    const brokers = cluster.brokers.map((b) => ({
      nodeId: b.nodeId,
      host: b.host,
      port: b.port,
      isController: b.nodeId === cluster.controller,
    }));

    // Enrich with describeLogDirs (disk usage) — best effort. The admin
    // method is in kafkajs but not all versions type it.
    try {
      const logDirs = await (
        admin as unknown as {
          describeLogDirs: (
            brokerIds: number[],
          ) => Promise<
            Array<{
              brokerId: number;
              logDirs?: Array<{
                topics?: Array<{
                  partitions?: Array<{ size?: number; partition?: number }>;
                }>;
              }>;
            }>
          >;
        }
      ).describeLogDirs(brokers.map((b) => b.nodeId));
      for (const broker of brokers as BrokerInfo[]) {
        const ld = logDirs.find((d) => d.brokerId === broker.nodeId);
        if (ld) {
          let total = 0;
          for (const dir of ld.logDirs ?? []) {
            for (const t of dir.topics ?? []) {
              for (const p of t.partitions ?? []) {
                total += Number(p.size ?? 0);
              }
            }
          }
          broker.totalLogBytes = total;
        }
      }
    } catch {
      // Older brokers / restricted ACLs — skip silently.
    }

    // Enrich with leader / replica counts from topic metadata.
    try {
      const topicNames = await admin.listTopics();
      if (topicNames && topicNames.length > 0) {
        const meta = await admin.fetchTopicMetadata({ topics: topicNames });
        const partitionByBroker = new Map<number, number>();
        const leaderByBroker = new Map<number, number>();
        for (const t of meta?.topics ?? []) {
          for (const p of t.partitions ?? []) {
            for (const r of p.replicas ?? []) {
              partitionByBroker.set(r, (partitionByBroker.get(r) ?? 0) + 1);
            }
            if (typeof p.leader === "number") {
              leaderByBroker.set(
                p.leader,
                (leaderByBroker.get(p.leader) ?? 0) + 1,
              );
            }
          }
        }
        for (const broker of brokers as BrokerInfo[]) {
          broker.partitionCount = partitionByBroker.get(broker.nodeId) ?? 0;
          broker.leaderCount = leaderByBroker.get(broker.nodeId) ?? 0;
        }
      } else {
        for (const broker of brokers as BrokerInfo[]) {
          broker.partitionCount = 0;
          broker.leaderCount = 0;
        }
      }
    } catch {
      // skip
    }

    return brokers;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

// ─── cluster health: under-replicated partitions + reassignments ───────

export interface UnderReplicatedPartition {
  topic: string;
  partition: number;
  leader: number;
  replicas: number[];
  isr: number[];
  /** Replicas that are present in `replicas` but missing from ISR. */
  outOfSync: number[];
}

export async function listUnderReplicated(
  config: KafkaConfig,
): Promise<UnderReplicatedPartition[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const names = await admin.listTopics();
    if (!names || names.length === 0) return [];
    const meta = await admin.fetchTopicMetadata({ topics: names });
    const out: UnderReplicatedPartition[] = [];
    for (const t of meta?.topics ?? []) {
      for (const p of t.partitions ?? []) {
        const replicas = p.replicas ?? [];
        const isr = p.isr ?? [];
        const oos = replicas.filter((r) => !isr.includes(r));
        if (oos.length > 0) {
          out.push({
            topic: t.name,
            partition: p.partitionId,
            leader: p.leader,
            replicas,
            isr,
            outOfSync: oos,
          });
        }
      }
    }
    return out;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface ReassignmentSpec {
  topic: string;
  partition: number;
  replicas: number[];
}

/**
 * Kicks off partition reassignment via Kafka's AlterPartitionReassignments
 * RPC (KIP-455). Returns immediately — call listOngoingReassignments() to
 * watch progress.
 */
export async function alterReassignments(
  config: KafkaConfig,
  specs: ReassignmentSpec[],
): Promise<void> {
  if (specs.length === 0) return;
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    // kafkajs exposes alterPartitionReassignments under topics shape.
    const grouped = new Map<
      string,
      Array<{ partition: number; replicas: number[] }>
    >();
    for (const s of specs) {
      const arr = grouped.get(s.topic) ?? [];
      arr.push({ partition: s.partition, replicas: s.replicas });
      grouped.set(s.topic, arr);
    }
    await (admin as unknown as {
      alterPartitionReassignments: (args: {
        topics: Array<{
          topic: string;
          partitions: Array<{ partition: number; replicas: number[] }>;
        }>;
      }) => Promise<unknown>;
    }).alterPartitionReassignments({
      topics: [...grouped.entries()].map(([topic, partitions]) => ({
        topic,
        partitions,
      })),
    });
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export interface OngoingReassignment {
  topic: string;
  partition: number;
  /** Current replica set per the broker's view. */
  replicas: number[];
  /** Replicas being added (incoming). */
  addingReplicas: number[];
  /** Replicas being removed (outgoing). */
  removingReplicas: number[];
}

export async function listOngoingReassignments(
  config: KafkaConfig,
): Promise<OngoingReassignment[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    // Not every kafkajs version exposes listPartitionReassignments, and not
    // every broker implements KIP-455 (older Zookeeper-based clusters).
    // Treat any failure here as "no reassignments visible" — the empty
    // list is the right user-facing answer.
    const fn = (
      admin as unknown as {
        listPartitionReassignments?: () => Promise<{
          topics?: Array<{
            name: string;
            partitions?: Array<{
              partitionIndex: number;
              replicas?: number[];
              addingReplicas?: number[];
              removingReplicas?: number[];
            }>;
          }>;
        }>;
      }
    ).listPartitionReassignments;
    if (typeof fn !== "function") return [];
    let res: {
      topics?: Array<{
        name: string;
        partitions?: Array<{
          partitionIndex: number;
          replicas?: number[];
          addingReplicas?: number[];
          removingReplicas?: number[];
        }>;
      }>;
    } | undefined;
    try {
      res = await fn.call(admin);
    } catch {
      return [];
    }
    const out: OngoingReassignment[] = [];
    for (const t of res?.topics ?? []) {
      for (const p of t.partitions ?? []) {
        out.push({
          topic: t.name,
          partition: p.partitionIndex,
          replicas: p.replicas ?? [],
          addingReplicas: p.addingReplicas ?? [],
          removingReplicas: p.removingReplicas ?? [],
        });
      }
    }
    return out;
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

export interface PulseSample {
  /** Wall-clock ms when this snapshot was taken. */
  at: number;
  underReplicated: number;
  offlinePartitions: number;
  controllerId: number | null;
  brokerCount: number;
}

/**
 * Tiny health snapshot — cheaper than getClusterSummary because it skips
 * the per-topic offset fan-out and consumer-group describe pass. Used as
 * the 5-second pulse tick on the cluster overview.
 */
export async function fetchPulse(config: KafkaConfig): Promise<PulseSample> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const [cluster, metadata] = await Promise.all([
      admin.describeCluster(),
      admin.fetchTopicMetadata(),
    ]);
    let underReplicated = 0;
    let offlinePartitions = 0;
    for (const t of metadata?.topics ?? []) {
      for (const p of t.partitions ?? []) {
        const replicas = p.replicas ?? [];
        const isr = p.isr ?? [];
        if (isr.length < replicas.length) underReplicated += 1;
        if (typeof p.leader === "number" && p.leader < 0) offlinePartitions += 1;
      }
    }
    return {
      at: Date.now(),
      underReplicated,
      offlinePartitions,
      controllerId: cluster.controller ?? null,
      brokerCount: cluster.brokers.length,
    };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

// ─── server-side search ─────────────────────────────────────────────────

export interface SearchPredicate {
  /** Substring match against the (decoded or raw) key. */
  key?: string;
  /** Substring matches against header values, ANDed. */
  headers?: Record<string, string>;
  /** JSON path expression like `$.user.id` or `$.[0].order` (read-only). */
  jsonPath?: string;
  /** Expected value for the JSON path; matched as exact string compare. */
  jsonPathEquals?: string;
  /** Substring/regex against the rendered value text. */
  valueContains?: string;
  /** Treat valueContains as a regex. */
  regex?: boolean;
}

export interface SearchOptions {
  /** Maximum number of messages to return. */
  matchLimit: number;
  /**
   * Hard cap on messages scanned per partition before giving up — protects
   * against running away on a huge topic. Defaults to 50 000.
   */
  scanCap: number;
  /**
   * Bound the scan to a starting wall-clock millisecond. When set, the
   * driver calls fetchTopicOffsetsByTimestamp() to seek per-partition.
   */
  startTimestamp?: number;
  schemaRegistry?: SchemaRegistryClient | null;
}

export interface SearchMatch {
  message: KafkaMessage;
  /** Where in the partition the match landed (for "continue from here" cursors). */
  cursor: { partition: number; offset: string };
}

export type SearchEvent =
  | { kind: "progress"; scanned: number; matched: number }
  | { kind: "match"; match: SearchMatch }
  | { kind: "done"; scanned: number; matched: number; truncated: boolean }
  | { kind: "error"; message: string };

/**
 * Read a tiny `$.foo.bar` accessor on a parsed JSON value. We support dotted
 * paths and `[n]` array indexing only — anything else falls back to null.
 */
function readJsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith("$")) return null;
  const segments = path
    .slice(1)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function predicateMatches(m: KafkaMessage, p: SearchPredicate): boolean {
  if (p.key) {
    const k = (m.key ?? "").toLowerCase();
    if (!k.includes(p.key.toLowerCase())) return false;
  }
  if (p.headers) {
    for (const [hk, hv] of Object.entries(p.headers)) {
      const got = m.headers[hk];
      if (got == null || !got.toLowerCase().includes(hv.toLowerCase())) {
        return false;
      }
    }
  }
  const valueText = m.valueDecoded?.json ?? m.value ?? "";
  if (p.valueContains) {
    if (p.regex) {
      try {
        if (!new RegExp(p.valueContains).test(valueText)) return false;
      } catch {
        return false; // bad regex — treat as no match
      }
    } else {
      if (
        !valueText.toLowerCase().includes(p.valueContains.toLowerCase())
      )
        return false;
    }
  }
  if (p.jsonPath) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(valueText);
    } catch {
      return false;
    }
    const v = readJsonPath(parsed, p.jsonPath);
    if (v == null) return false;
    if (p.jsonPathEquals != null) {
      if (String(v) !== p.jsonPathEquals) return false;
    }
  }
  return true;
}

/**
 * Scan a topic from `startTimestamp` (or earliest) until `matchLimit`
 * messages match the predicate OR `scanCap * partitions` messages have
 * been examined. Emits `progress` events while scanning so the UI can
 * show a progress bar without waiting for the whole scan to complete.
 */
export async function searchMessages(
  config: KafkaConfig,
  topic: string,
  predicate: SearchPredicate,
  options: SearchOptions,
  emit: (ev: SearchEvent) => void,
): Promise<void> {
  const client = createKafkaClient(config);
  const groupId = `baklava-search-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const consumer = client.consumer({
    groupId,
    sessionTimeout: 10000,
    heartbeatInterval: 3000,
  });
  await consumer.connect();
  let stopped = false;
  let scanned = 0;
  let matched = 0;
  try {
    await consumer.subscribe({ topic, fromBeginning: true });

    let seekOffsetsByPartition: Record<number, string> | null = null;
    if (options.startTimestamp != null) {
      const admin = client.admin();
      await admin.connect();
      try {
        const offsets = await admin.fetchTopicOffsetsByTimestamp(
          topic,
          options.startTimestamp,
        );
        seekOffsetsByPartition = {};
        for (const { partition, offset } of offsets) {
          seekOffsetsByPartition[partition] = offset;
        }
      } finally {
        await admin.disconnect().catch(() => undefined);
      }
    }

    let lastProgressEmit = Date.now();

    await new Promise<void>((resolve) => {
      // Hard deadline so we never run forever — 30s scan budget.
      const deadline = setTimeout(() => {
        stopped = true;
        resolve();
      }, 30_000);

      consumer
        .run({
          autoCommit: false,
          eachMessage: async ({ partition, message }) => {
            if (stopped) return;
            scanned += 1;
            const m = await materializeMessage({
              partition,
              offset: message.offset,
              timestamp: message.timestamp,
              key: message.key,
              value: message.value,
              headers: decodeHeaders(message.headers),
              schemaRegistry: options.schemaRegistry,
            });
            if (predicateMatches(m, predicate)) {
              matched += 1;
              emit({
                kind: "match",
                match: {
                  message: m,
                  cursor: { partition, offset: message.offset },
                },
              });
            }
            // Progress heartbeat at most every 250ms.
            const now = Date.now();
            if (now - lastProgressEmit > 250) {
              emit({ kind: "progress", scanned, matched });
              lastProgressEmit = now;
            }
            if (matched >= options.matchLimit || scanned >= options.scanCap) {
              stopped = true;
              clearTimeout(deadline);
              resolve();
            }
          },
        })
        .catch(() => {
          clearTimeout(deadline);
          resolve();
        });

      // Seek per-partition after kafkajs has assigned them.
      if (seekOffsetsByPartition) {
        const trySeek = () => {
          try {
            for (const [pStr, off] of Object.entries(seekOffsetsByPartition!)) {
              consumer.seek({
                topic,
                partition: Number(pStr),
                offset: off,
              });
            }
          } catch {
            setTimeout(trySeek, 100);
          }
        };
        setTimeout(trySeek, 400);
      }
    });

    emit({
      kind: "done",
      scanned,
      matched,
      truncated: matched >= options.matchLimit || scanned >= options.scanCap,
    });
  } catch (err) {
    emit({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
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
    } catch {
      // ignore
    }
  }
}

// ─── backup / restore ───────────────────────────────────────────────────

export interface BackupOptions {
  /** Stop after this many messages (0 = no cap). */
  limit?: number;
  /** Only back up messages at/after this wall-clock ms. */
  startTimestamp?: number;
  schemaRegistry?: SchemaRegistryClient | null;
}

export interface BackupLine {
  partition: number;
  offset: string;
  timestamp: string;
  /** Base64 of the raw key bytes — lossless, so binary keys survive. */
  keyBase64: string | null;
  /** Base64 of the raw value bytes. */
  valueBase64: string | null;
  headers: Record<string, string>;
}

/**
 * Streams a topic to JSONL — one message per line — as an async generator.
 * Keys and values are base64-encoded so binary payloads (Avro, protobuf,
 * UUID keys) survive the round-trip losslessly. Restorable via
 * {@link restoreTopic}.
 */
export async function* streamTopicBackup(
  config: KafkaConfig,
  topic: string,
  options: BackupOptions = {},
): AsyncGenerator<string> {
  const limit = options.limit ?? 0;
  const client = createKafkaClient(config);
  const groupId = `baklava-backup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const consumer = client.consumer({
    groupId,
    sessionTimeout: 10_000,
    heartbeatInterval: 3_000,
  });
  await consumer.connect();

  // Bridge the kafkajs push-callback into an async pull generator via a
  // bounded queue + promise handshake.
  const queue: BackupLine[] = [];
  let resolveNext: (() => void) | null = null;
  let finished = false;
  let count = 0;

  const wake = () => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  try {
    await consumer.subscribe({ topic, fromBeginning: true });

    let seekOffsets: Record<number, string> | null = null;
    if (options.startTimestamp != null) {
      const admin = client.admin();
      await admin.connect();
      try {
        const offs = await admin.fetchTopicOffsetsByTimestamp(
          topic,
          options.startTimestamp,
        );
        seekOffsets = {};
        for (const { partition, offset } of offs) seekOffsets[partition] = offset;
      } finally {
        await admin.disconnect().catch(() => undefined);
      }
    }

    // 8s of silence with an empty queue ends the backup — we've drained the
    // log. (Kafka has no "end of topic" signal for a live consumer.)
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finished = true;
        wake();
      }, 8_000);
    };

    void consumer
      .run({
        autoCommit: false,
        eachMessage: async ({ partition, message }) => {
          queue.push({
            partition,
            offset: message.offset,
            timestamp: message.timestamp,
            keyBase64: message.key ? message.key.toString("base64") : null,
            valueBase64: message.value
              ? message.value.toString("base64")
              : null,
            headers: decodeHeaders(message.headers),
          });
          armIdle();
          wake();
        },
      })
      .catch(() => {
        finished = true;
        wake();
      });

    if (seekOffsets) {
      const trySeek = () => {
        try {
          for (const [p, off] of Object.entries(seekOffsets!)) {
            consumer.seek({ topic, partition: Number(p), offset: off });
          }
        } catch {
          setTimeout(trySeek, 100);
        }
      };
      setTimeout(trySeek, 400);
    }

    armIdle();

    for (;;) {
      if (queue.length > 0) {
        const line = queue.shift()!;
        yield JSON.stringify(line) + "\n";
        count += 1;
        if (limit > 0 && count >= limit) break;
        continue;
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
    if (idleTimer) clearTimeout(idleTimer);
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
    } catch {
      // ignore
    }
  }
}

export interface RestoreTopicResult {
  produced: number;
  skipped: number;
  error?: string;
}

export type PartitionStrategy = "original" | "auto";

/**
 * Produce messages from a JSONL backup back into a topic. Keys + headers are
 * preserved (decoded from base64). `partitionStrategy`:
 *   - "original": pin each message to its recorded partition (only valid if
 *     the target has at least as many partitions).
 *   - "auto": let Kafka assign by key hash / round-robin.
 */
export async function restoreTopic(
  config: KafkaConfig,
  targetTopic: string,
  jsonl: string,
  partitionStrategy: PartitionStrategy = "auto",
): Promise<RestoreTopicResult> {
  const client = createKafkaClient(config);
  const producer = client.producer();
  await producer.connect();
  let produced = 0;
  let skipped = 0;
  try {
    const lines = jsonl.split("\n");
    const batch: {
      partition?: number;
      key: Buffer | null;
      value: Buffer | null;
      headers: Record<string, string>;
    }[] = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let parsed: BackupLine;
      try {
        parsed = JSON.parse(line) as BackupLine;
      } catch {
        skipped += 1;
        continue;
      }
      batch.push({
        partition:
          partitionStrategy === "original" ? parsed.partition : undefined,
        key: parsed.keyBase64
          ? Buffer.from(parsed.keyBase64, "base64")
          : null,
        value: parsed.valueBase64
          ? Buffer.from(parsed.valueBase64, "base64")
          : null,
        headers: parsed.headers ?? {},
      });
      // Flush in batches of 500 to bound memory + request size.
      if (batch.length >= 500) {
        await producer.send({ topic: targetTopic, messages: batch.splice(0) });
        produced += 500;
      }
    }
    if (batch.length > 0) {
      const n = batch.length;
      await producer.send({ topic: targetTopic, messages: batch });
      produced += n;
    }
    return { produced, skipped };
  } catch (err) {
    return {
      produced,
      skipped,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await producer.disconnect().catch(() => undefined);
  }
}

export type TailMessage = KafkaMessage;

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
  opts: {
    topic: string;
    fromBeginning?: boolean;
    partition?: number;
    schemaRegistry?: SchemaRegistryClient | null;
  },
  onMessage: (m: TailMessage) => void,
  onError: (err: unknown) => void,
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
        const m = await materializeMessage({
          partition,
          offset: message.offset,
          timestamp: message.timestamp,
          key: message.key,
          value: message.value,
          headers: decodeHeaders(message.headers),
          schemaRegistry: opts.schemaRegistry,
        });
        onMessage(m);
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
  /** Partitions reporting leader = -1 (no broker available). */
  offlinePartitions: number;
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

    // Internal topics (__consumer_offsets, __transaction_state, …) are
    // separated from user-visible counts so the KPI tiles are consistent
    // with each other AND with the "Top topics by volume" leaderboard,
    // which has always filtered them out. Health signals
    // (under-replicated / offline) still scan every topic because an
    // unhealthy __consumer_offsets is itself an on-call problem.
    const isInternal = (name: string) => name.startsWith("__");

    let totalPartitions = 0;
    let underReplicatedPartitions = 0;
    let offlinePartitions = 0;
    const underReplicatedTopics = new Set<string>();
    let userTopicCount = 0;
    let internalTopicCount = 0;

    for (const t of metadata.topics) {
      if (isInternal(t.name)) {
        internalTopicCount += 1;
      } else {
        userTopicCount += 1;
        totalPartitions += t.partitions.length;
      }
      for (const p of t.partitions) {
        if (p.isr.length < p.replicas.length) {
          underReplicatedPartitions += 1;
          underReplicatedTopics.add(t.name);
        }
        // leader === -1 means no broker is currently serving this partition —
        // the classic "offline" signal that pages on-call.
        if (typeof p.leader === "number" && p.leader < 0) {
          offlinePartitions += 1;
        }
      }
    }

    // Per-topic message totals (sum high-low across partitions). Skip
    // internal topics so we don't waste an admin RPC on __consumer_offsets
    // and so the total matches what's visible in the leaderboard.
    const userTopics = metadata.topics.filter((t) => !isInternal(t.name));
    const offsetResults = await Promise.all(
      userTopics.map((t) =>
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
      offlinePartitions,
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

// ─────────────────────────────────────────────────────────────────────────────
// Operational actions on consumer groups
//   - cloneConsumerGroup  : copy committed offsets from src → dst (new group)
//   - skipPartitionOffset : advance one (topic, partition) by N (poison-skip)
//   - importGroupOffsets  : commit a {topic, partition, offset}[] snapshot
//   - bulkDeleteGroups    : delete a set of groups in one admin call
// All routed through commitGroupOffsetsClean per topic so we never leave
// phantom consumer members behind.
// ─────────────────────────────────────────────────────────────────────────────

export interface OffsetSnapshotEntry {
  topic: string;
  partition: number;
  offset: string;
}

async function fetchGroupOffsetsRaw(
  config: KafkaConfig,
  groupId: string,
): Promise<OffsetSnapshotEntry[]> {
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    const raw = await admin.fetchOffsets({ groupId });
    const out: OffsetSnapshotEntry[] = [];
    for (const t of raw) {
      for (const p of t.partitions) {
        // -1 means "no committed offset" — skip those, otherwise the
        // destination group would commit a garbage offset.
        if (p.offset && p.offset !== "-1") {
          out.push({ topic: t.topic, partition: p.partition, offset: p.offset });
        }
      }
    }
    return out;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

export async function cloneConsumerGroup(
  config: KafkaConfig,
  sourceGroupId: string,
  targetGroupId: string,
): Promise<{ copied: number; topics: string[] }> {
  if (!targetGroupId.trim()) throw new Error("Target group id is required");
  if (sourceGroupId === targetGroupId)
    throw new Error("Target must differ from source");
  const entries = await fetchGroupOffsetsRaw(config, sourceGroupId);
  if (entries.length === 0) {
    throw new Error("Source group has no committed offsets to clone");
  }
  // Group by topic so each commitGroupOffsetsClean call is single-topic-scoped.
  const byTopic = new Map<string, { partition: number; offset: string }[]>();
  for (const e of entries) {
    const arr = byTopic.get(e.topic) ?? [];
    arr.push({ partition: e.partition, offset: e.offset });
    byTopic.set(e.topic, arr);
  }
  for (const [topic, partitions] of byTopic) {
    await commitGroupOffsetsClean(config, targetGroupId, topic, partitions);
  }
  return { copied: entries.length, topics: [...byTopic.keys()] };
}

export async function skipPartitionOffset(
  config: KafkaConfig,
  groupId: string,
  topic: string,
  partition: number,
  count = 1,
): Promise<{ from: string; to: string }> {
  if (!Number.isFinite(count) || count < 1) {
    throw new Error("Skip count must be a positive integer");
  }
  if (count > 1_000_000) {
    throw new Error("Skip count is too large (max 1,000,000)");
  }
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  let currentOffset: string;
  let highWater: string;
  try {
    const [offsetsRaw, highWaters] = await Promise.all([
      admin.fetchOffsets({ groupId }),
      admin.fetchTopicOffsets(topic),
    ]);
    const topicEntry = offsetsRaw.find((t) => t.topic === topic);
    const partitionEntry = topicEntry?.partitions.find(
      (p) => p.partition === partition,
    );
    if (!partitionEntry || partitionEntry.offset === "-1") {
      throw new Error(
        `No committed offset for ${topic}[${partition}] — nothing to skip past`,
      );
    }
    currentOffset = partitionEntry.offset;
    const highEntry = highWaters.find((h) => h.partition === partition);
    highWater = highEntry?.high ?? "-1";
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
  // Don't skip past the high water mark — it's a no-op and would commit
  // a future offset, blocking real consumption.
  const target = String(
    Math.min(Number(currentOffset) + count, Number(highWater)),
  );
  if (target === currentOffset) {
    throw new Error(
      "Already at the high water mark — nothing to skip past",
    );
  }
  await commitGroupOffsetsClean(config, groupId, topic, [
    { partition, offset: target },
  ]);
  return { from: currentOffset, to: target };
}

export async function importGroupOffsets(
  config: KafkaConfig,
  groupId: string,
  snapshot: OffsetSnapshotEntry[],
): Promise<{ committed: number; topics: string[] }> {
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    throw new Error("Snapshot is empty");
  }
  const byTopic = new Map<string, { partition: number; offset: string }[]>();
  for (const e of snapshot) {
    if (
      typeof e.topic !== "string" ||
      typeof e.partition !== "number" ||
      typeof e.offset !== "string"
    ) {
      throw new Error("Snapshot entries must be {topic, partition, offset}");
    }
    const arr = byTopic.get(e.topic) ?? [];
    arr.push({ partition: e.partition, offset: e.offset });
    byTopic.set(e.topic, arr);
  }
  for (const [topic, partitions] of byTopic) {
    await commitGroupOffsetsClean(config, groupId, topic, partitions);
  }
  return { committed: snapshot.length, topics: [...byTopic.keys()] };
}

export async function bulkDeleteConsumerGroups(
  config: KafkaConfig,
  groupIds: string[],
): Promise<{
  deleted: string[];
  failed: { groupId: string; error: string }[];
}> {
  if (groupIds.length === 0) {
    return { deleted: [], failed: [] };
  }
  const client = createKafkaClient(config);
  const admin = client.admin();
  await admin.connect();
  try {
    // admin.deleteGroups returns per-group results. We translate the
    // shape so the UI gets clean { deleted, failed } arrays.
    const results = await admin.deleteGroups(groupIds);
    const deleted: string[] = [];
    const failed: { groupId: string; error: string }[] = [];
    for (const r of results) {
      if (r.errorCode === 0 || r.errorCode == null) {
        deleted.push(r.groupId);
      } else {
        failed.push({
          groupId: r.groupId,
          error: `errorCode ${r.errorCode}`,
        });
      }
    }
    return { deleted, failed };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}
