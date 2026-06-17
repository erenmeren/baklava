// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { KafkaConfig } from "@/lib/connections/types";
import { probeKafka } from "@/lib/connections/kafka";
import { kafkaBody } from "@/lib/connections/health";
import { kafkaMeta } from "./meta";

export const kafka: TechModule<KafkaConfig> = {
  ...kafkaMeta,
  driver: { probe: (c) => probeKafka(c), health: kafkaBody },
};
