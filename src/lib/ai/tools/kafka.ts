import { z } from "zod";
import type { KafkaConfig } from "@/lib/connections/types";
import {
  listTopicsWithStats,
  describeTopic,
  fetchMessages,
  listConsumerGroupsWithLag,
  describeConsumerGroup,
  getClusterSummary,
  produceMessage,
  createTopic,
  alterTopicConfig,
  addTopicPartitions,
  deleteTopic,
  emptyTopic,
  resetGroupOffsets,
  deleteConsumerGroup,
} from "@/lib/connections/kafka";
import type { AiTool } from "./types";

export function kafkaTools(_connectionId: string, config: KafkaConfig): AiTool[] {
  return [
    {
      name: "kafka_list_topics",
      description: "List topics with partition counts and message totals.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listTopicsWithStats(config),
    },
    {
      name: "kafka_describe_topic",
      description: "Partitions, offsets, ISR and configs for a topic.",
      category: "read",
      inputSchema: z.object({ topic: z.string() }),
      execute: async ({ topic }) => describeTopic(config, topic as string),
    },
    {
      name: "kafka_fetch_messages",
      description:
        "Read up to `limit` messages from a topic (read-only; uses an ephemeral consumer group).",
      category: "read",
      inputSchema: z.object({
        topic: z.string(),
        limit: z.number().int().min(1).max(200).default(20),
        fromBeginning: z.boolean().default(false),
        partition: z.number().int().min(0).optional(),
      }),
      execute: async ({ topic, limit, fromBeginning, partition }) =>
        fetchMessages(config, topic as string, {
          limit: (limit as number) ?? 20,
          fromBeginning: (fromBeginning as boolean) ?? false,
          partition: partition as number | undefined,
        }),
    },
    {
      name: "kafka_list_consumer_groups",
      description:
        "List consumer groups with member count, topic count and total lag.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listConsumerGroupsWithLag(config),
    },
    {
      name: "kafka_describe_consumer_group",
      description:
        "Members and per-partition offsets/lag for a consumer group.",
      category: "read",
      inputSchema: z.object({ groupId: z.string() }),
      execute: async ({ groupId }) =>
        describeConsumerGroup(config, groupId as string),
    },
    {
      name: "kafka_cluster_summary",
      description:
        "Brokers, controller, topic/partition counts, under-replicated/offline partitions, top topics.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => getClusterSummary(config),
    },
    {
      name: "kafka_produce_message",
      description: "Produce a single message to a topic.",
      category: "write",
      inputSchema: z.object({
        topic: z.string(),
        value: z.string(),
        key: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      execute: async ({ topic, value, key, headers }) => {
        await produceMessage(config, topic as string, {
          value: value as string,
          key: key as string | undefined,
          headers: headers as Record<string, string> | undefined,
        });
        return { ok: true, topic };
      },
    },
    {
      name: "kafka_create_topic",
      description: "Create a topic.",
      category: "write",
      inputSchema: z.object({
        name: z.string(),
        partitions: z.number().int().min(1).default(1),
        replicationFactor: z.number().int().min(1).default(1),
      }),
      execute: async ({ name, partitions, replicationFactor }) => {
        await createTopic(
          config,
          name as string,
          (partitions as number) ?? 1,
          (replicationFactor as number) ?? 1,
        );
        return { ok: true, created: name };
      },
    },
    {
      name: "kafka_alter_topic_config",
      description: "Set topic config entries (e.g. retention.ms).",
      category: "write",
      inputSchema: z.object({
        topic: z.string(),
        entries: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .min(1),
      }),
      execute: async ({ topic, entries }) => {
        await alterTopicConfig(
          config,
          topic as string,
          entries as { name: string; value: string }[],
        );
        return { ok: true, topic };
      },
    },
    {
      name: "kafka_add_partitions",
      description:
        "Increase a topic's partition count to `totalPartitions`.",
      category: "write",
      inputSchema: z.object({
        topic: z.string(),
        totalPartitions: z.number().int().min(1),
      }),
      execute: async ({ topic, totalPartitions }) => {
        await addTopicPartitions(
          config,
          topic as string,
          totalPartitions as number,
        );
        return { ok: true, topic };
      },
    },
    {
      name: "kafka_delete_topic",
      description: "Delete a topic. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        await deleteTopic(config, name as string);
        return { ok: true, deleted: name };
      },
    },
    {
      name: "kafka_empty_topic",
      description:
        "Delete and recreate a topic to drop all its messages. DESTRUCTIVE.",
      category: "destructive",
      inputSchema: z.object({ topic: z.string() }),
      execute: async ({ topic }) => {
        await emptyTopic(config, topic as string);
        return { ok: true, emptied: topic };
      },
    },
    {
      name: "kafka_reset_group_offsets",
      description:
        "Reset a consumer group's committed offsets for a topic to earliest or latest. DESTRUCTIVE (can skip or replay data).",
      category: "destructive",
      inputSchema: z.object({
        groupId: z.string(),
        topic: z.string(),
        target: z.enum(["earliest", "latest"]),
        partitions: z.array(z.number().int().min(0)).optional(),
      }),
      execute: async ({ groupId, topic, target, partitions }) => {
        await resetGroupOffsets(
          config,
          groupId as string,
          topic as string,
          { kind: target as "earliest" | "latest" },
          partitions as number[] | undefined,
        );
        return { ok: true, groupId, topic, target };
      },
    },
    {
      name: "kafka_delete_consumer_group",
      description: "Delete a consumer group. DESTRUCTIVE.",
      category: "destructive",
      inputSchema: z.object({ groupId: z.string() }),
      execute: async ({ groupId }) => {
        await deleteConsumerGroup(config, groupId as string);
        return { ok: true, deleted: groupId };
      },
    },
  ];
}
