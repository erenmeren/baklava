import { z } from "zod";
import type { TechModule } from "@/techs/contract";
import type { KafkaConfig, ConnectionRecord } from "@/lib/connections/types";
import { probeKafka } from "@/lib/connections/kafka";

const schema = z.object({
  clientId: z.string(),
  brokers: z.array(z.string()),
  ssl: z.boolean(),
  sasl: z.object({
    mechanism: z.enum(["plain", "scram-sha-256", "scram-sha-512"]),
    username: z.string(),
    password: z.string(),
  }).optional(),
  schemaRegistryUrl: z.string().optional(),
  schemaRegistryAuth: z.object({
    username: z.string(),
    password: z.string(),
  }).optional(),
});

export const kafka: TechModule<KafkaConfig> = {
  id: "kafka",
  catalog: {
    id: "kafka",
    name: "Kafka",
    tagline: "Streaming platform",
    description: "Browse topics, partitions and consumer groups.",
    category: "Streaming",
    color: "from-orange-400 to-red-600",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<KafkaConfig>, secretKeys: ["password"] },
  driver: { probe: (c) => probeKafka(c) },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as KafkaConfig;
    return cfg.brokers.join(", ");
  },
  firstPage: "",
  optionalDeps: ["kafkajs", "avsc"],
  serverPackages: ["kafkajs", "avsc"],
  capabilities: { browse: true, health: true },
};
