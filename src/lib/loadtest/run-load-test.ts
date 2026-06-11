import { formatError } from "@/lib/errors";
import type { Executor, Progress } from "./executor";
import { parseSummary, type LoadTestResult } from "./results";
import { generateK6Script } from "./script-gen";
import { loadTestConfigSchema, requiredEnvVars } from "./schema";

export interface RunOptions {
  /** Override the execution backend (defaults to K6DockerExecutor). */
  executor?: Executor;
  /** Live progress callback (one k6 stderr line at a time). */
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  /** Source of secret env vars (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

export async function runLoadTest(
  input: unknown,
  opts: RunOptions = {},
): Promise<LoadTestResult> {
  const config = loadTestConfigSchema.parse(input);
  const script = generateK6Script(config);

  const env = opts.env ?? process.env;
  const secrets: Record<string, string> = {};
  for (const name of requiredEnvVars(config.auth)) {
    const value = env[name];
    if (value == null || value === "") {
      throw new Error(`Missing required environment variable for auth: ${name}`);
    }
    secrets[name] = value;
  }

  let executor = opts.executor;
  if (!executor) {
    const { K6DockerExecutor } = await import("./executors/k6-docker");
    executor = new K6DockerExecutor();
  }

  try {
    const output = await executor.run(
      script,
      { env: secrets, signal: opts.signal },
      opts.onProgress ?? (() => {}),
    );
    return parseSummary(output.summary, config);
  } catch (err) {
    throw new Error(formatError(err));
  }
}
