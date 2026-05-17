import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";

let counter = 0;

function nextId(prefix = "test"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function makeConnection<C extends Record<string, unknown>>(
  tech: TechId,
  config: C,
  overrides: Partial<ConnectionRecord<C>> = {},
): ConnectionRecord<C> {
  return {
    id: overrides.id ?? nextId(tech),
    tech,
    name: overrides.name ?? `Test ${tech}`,
    config,
    status: overrides.status ?? "ok",
    createdAt: overrides.createdAt ?? Date.now(),
    lastTestedAt: overrides.lastTestedAt ?? Date.now(),
    ...overrides,
  };
}

/**
 * Create an isolated data dir for tests that actually exercise persistence.
 * Returns a teardown the caller MUST invoke in afterAll/afterEach.
 *
 * Usage:
 *   const { dir, cleanup } = await tempDataDir();
 *   process.env.BAKLAVA_DATA_DIR = dir;
 *   // ...
 *   await cleanup();
 */
export async function tempDataDir(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "baklava-test-"));
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The kafka SASL nesting case from project_persistence.md — the redactor
 * and mergeConfig must recurse into this.
 */
export const KAFKA_SAMPLE_CONFIG = {
  clientId: "baklava",
  brokers: ["localhost:9092"],
  ssl: false,
  sasl: {
    mechanism: "plain" as const,
    username: "kafka",
    password: "secret-kafka-pw",
  },
};

export const POSTGRES_SAMPLE_CONFIG = {
  host: "localhost",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: "secret-pg-pw",
  ssl: false,
};
