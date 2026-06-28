import { formatError } from "@/lib/errors";
import type { LoadTestResult } from "./results";
import { runLoadTest, type RunOptions } from "./run-load-test";
import { appendRun, updateRun, type LoadTest, type LoadTestRun } from "./store";
import { toEngineConfig } from "./to-engine-config";

export interface RunEvents {
  onProgress: (line: string) => void;
  onResult: (result: LoadTestResult) => void;
  onError: (message: string) => void;
}

export type Runner = (input: unknown, opts: RunOptions) => Promise<LoadTestResult>;

export interface ExecuteRunOptions {
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the real engine. */
  runner?: Runner;
}

/**
 * Orchestrate one run: create a run record, invoke the engine (translating the
 * saved config + secrets), stream events, and persist the terminal status.
 * Threshold breach → "failed" (NOT an error). Abort → "cancelled".
 */
export async function executeRun(
  test: LoadTest,
  events: RunEvents,
  opts: ExecuteRunOptions = {},
): Promise<LoadTestRun> {
  const runner = opts.runner ?? runLoadTest;
  const { config, env } = toEngineConfig(test.config, test.name);
  // `test` is already the caller-owned record (resolved via getLoadTest in the
  // route), so its ownerId is the correct scope for the run accessors.
  const owner = test.ownerId;
  const run = appendRun(test.id, owner, { startedAt: Date.now(), status: "running" });

  try {
    const result = await runner(config, {
      env,
      signal: opts.signal,
      onProgress: (p) => events.onProgress(p.line),
    });
    events.onResult(result);
    return updateRun(test.id, owner, run.id, {
      status: result.passed ? "passed" : "failed",
      result,
      finishedAt: Date.now(),
    })!;
  } catch (err) {
    if (opts.signal?.aborted) {
      return updateRun(test.id, owner, run.id, { status: "cancelled", finishedAt: Date.now() })!;
    }
    const message = formatError(err);
    events.onError(message);
    return updateRun(test.id, owner, run.id, {
      status: "error",
      error: message,
      finishedAt: Date.now(),
    })!;
  }
}
