import net from "node:net";
import { formatError } from "@/lib/errors";
import { assertHostAllowed, blockedCidrsHonouringAllowList } from "@/lib/net/egress";
import type { Executor, Progress } from "./executor";
import { parseSummary, type LoadTestResult } from "./results";
import { generateK6Script } from "./script-gen";
import { loadTestConfigSchema, requiredEnvVars } from "./schema";
import { normalizeBaseUrl, rewriteLocalhostForDocker } from "./url";

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

  // SSRF guard: block metadata/link-local targets before launching k6.
  // Private/loopback stay allowed (the localhost→host.docker.internal rewrite
  // is the intended "test my local service" path).
  const targetHost = new URL(normalizeBaseUrl(config.target.baseUrl)).hostname;
  const ips = await assertHostAllowed(targetHost);
  // Pin a real hostname to the address we just checked (see script-gen). IP
  // literals need no pin, and a localhost target is rewritten to
  // host.docker.internal, which only resolves inside the k6 container.
  const { rewritten } = rewriteLocalhostForDocker(config.target.baseUrl);
  const pinnedHosts =
    !rewritten && !net.isIP(targetHost.replace(/^\[|\]$/g, "")) && ips[0]
      ? { [targetHost]: ips[0] }
      : undefined;

  // If an operator allow-listed an address inside a blocked range, that range
  // can't be blacklisted wholesale — fall back to not following redirects.
  const { cidrs, carvedOut } = blockedCidrsHonouringAllowList();
  const script = generateK6Script(config, { pinnedHosts, blockedCidrs: cidrs, noRedirects: carvedOut });

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
