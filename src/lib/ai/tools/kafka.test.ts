import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/kafka", () => ({
  listTopicsWithStats: vi.fn(async () => []),
  describeTopic: vi.fn(async () => ({ name: "t", partitions: [], configs: [] })),
  fetchMessages: vi.fn(async () => []),
  listConsumerGroupsWithLag: vi.fn(async () => []),
  describeConsumerGroup: vi.fn(async () => ({ groupId: "g", state: "Empty", members: [], offsets: [] })),
  getClusterSummary: vi.fn(async () => ({ brokers: [] })),
  produceMessage: vi.fn(async () => undefined),
  createTopic: vi.fn(async () => undefined),
  alterTopicConfig: vi.fn(async () => undefined),
  addTopicPartitions: vi.fn(async () => undefined),
  deleteTopic: vi.fn(async () => undefined),
  emptyTopic: vi.fn(async () => undefined),
  resetGroupOffsets: vi.fn(async () => undefined),
  deleteConsumerGroup: vi.fn(async () => undefined),
}));

import * as k from "@/lib/connections/kafka";
import { kafkaTools } from "./kafka";

const cfg = { clientId: "baklava", brokers: ["b:9092"], ssl: false };
const tools = () => kafkaTools("c1", cfg as never);

describe("kafkaTools", () => {
  beforeEach(() => vi.clearAllMocks());
  it("tags categories", () => {
    const cat = Object.fromEntries(tools().map((t) => [t.name, t.category]));
    expect(cat["kafka_fetch_messages"]).toBe("read");
    expect(cat["kafka_produce_message"]).toBe("write");
    expect(cat["kafka_delete_topic"]).toBe("destructive");
    expect(cat["kafka_empty_topic"]).toBe("destructive");
    expect(cat["kafka_reset_group_offsets"]).toBe("destructive");
  });
  it("kafka_produce_message delegates", async () => {
    const t = tools().find((x) => x.name === "kafka_produce_message")!;
    await t.execute({ topic: "t", value: "hi" });
    expect(k.produceMessage).toHaveBeenCalledWith(cfg, "t", expect.objectContaining({ value: "hi" }));
  });
  it("kafka_fetch_messages delegates with limit + fromBeginning", async () => {
    const t = tools().find((x) => x.name === "kafka_fetch_messages")!;
    await t.execute({ topic: "t", limit: 10, fromBeginning: true });
    expect(k.fetchMessages).toHaveBeenCalledWith(cfg, "t", expect.objectContaining({ limit: 10, fromBeginning: true }));
  });
  it("kafka_reset_group_offsets passes a target", async () => {
    const t = tools().find((x) => x.name === "kafka_reset_group_offsets")!;
    await t.execute({ groupId: "g", topic: "t", target: "earliest" });
    expect(k.resetGroupOffsets).toHaveBeenCalledWith(cfg, "g", "t", { kind: "earliest" }, undefined);
  });
});

describe("kafka_alter_topic_config escalation", () => {
  const alter = () => tools().find((t) => t.name === "kafka_alter_topic_config")!;
  it.each(["retention.ms", "retention.bytes", "local.retention.ms", "cleanup.policy", "segment.ms"])(
    "%s can make the broker delete messages → destructive",
    (name) => expect(alter().categoryFor?.({ entries: [{ name, value: "1" }] })).toBe("destructive"),
  );
  it("other settings stay a write", () => {
    expect(alter().categoryFor?.({ entries: [{ name: "max.message.bytes", value: "2000000" }] })).toBe("write");
  });
});
