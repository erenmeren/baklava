import type { Duplex, Writable } from "node:stream";
import { PassThrough } from "node:stream";
import { createDockerClient } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import type { Executor, Progress, RawRunOutput, RunOpts } from "../executor";
import { SUMMARY_END, SUMMARY_START } from "../script-gen";

const K6_IMAGE = "grafana/k6:latest";
const PASS_EXIT = 0;
const THRESHOLD_FAIL_EXIT = 99;

async function ensureImage(client: ReturnType<typeof createDockerClient>): Promise<void> {
  try {
    await client.getImage(K6_IMAGE).inspect();
    return; // already present
  } catch {
    // not present — pull it
  }
  await new Promise<void>((resolve, reject) => {
    client.pull(K6_IMAGE, (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) {
        reject(err || new Error("no pull stream"));
        return;
      }
      client.modem.followProgress(
        stream,
        (e: Error | null) => (e ? reject(e) : resolve()),
        () => undefined,
      );
    });
  });
}

function extractSummary(stdout: string): unknown {
  const start = stdout.indexOf(SUMMARY_START);
  const end = stdout.indexOf(SUMMARY_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("k6 produced no parseable summary (did the run start?)");
  }
  const json = stdout.slice(start + SUMMARY_START.length, end);
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error(`k6 summary JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export class K6DockerExecutor implements Executor {
  constructor(
    private dockerConfig: DockerConfig = { mode: "socket", socketPath: "/var/run/docker.sock" },
  ) {}

  async run(
    script: string,
    opts: RunOpts,
    onProgress: (p: Progress) => void,
  ): Promise<RawRunOutput> {
    const client = createDockerClient(this.dockerConfig);
    await ensureImage(client);

    const envArr = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);

    let container:
      | Awaited<ReturnType<ReturnType<typeof createDockerClient>["createContainer"]>>
      | undefined;
    let onAbort: (() => void) | undefined;

    try {
      container = await client.createContainer({
        Image: K6_IMAGE,
        Cmd: ["run", "--quiet", "-"], // read script from stdin
        Env: envArr,
        OpenStdin: true,
        StdinOnce: true,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        HostConfig: {
          ExtraHosts: ["host.docker.internal:host-gateway"],
        },
      });

      let stdout = "";
      const outStream = new PassThrough();
      const errStream = new PassThrough();
      outStream.on("data", (c: Buffer) => {
        stdout += c.toString("utf8");
      });
      errStream.on("data", (c: Buffer) => {
        for (const line of c.toString("utf8").split("\n")) {
          if (line.trim()) onProgress({ line: line.trimEnd() });
        }
      });

      const stream = (await container.attach({
        stream: true,
        hijack: true,
        stdin: true,
        stdout: true,
        stderr: true,
      })) as Duplex;
      container.modem.demuxStream(stream, outStream as Writable, errStream as Writable);
      // A closed socket (container exited early) would otherwise emit an
      // unhandled 'error' and crash the process; swallow it so the real
      // failure surfaces via the exit code / missing-summary path.
      stream.on("error", () => {});

      const c = container;
      onAbort = () => {
        stream.destroy();
        void c.remove({ force: true }).catch(() => undefined);
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      await container.start();
      // Feed the generated script via stdin, then signal EOF.
      stream.write(script);
      stream.end();

      const status = await container.wait({ abortSignal: opts.signal });
      const exitCode = status.StatusCode as number;

      // container.wait() and the hijacked attach socket are separate
      // connections; the daemon can signal exit before Node has dispatched
      // the final attach data chunks. Wait for the attach stream to close so
      // demuxStream has flushed the complete summary into `stdout`.
      await new Promise<void>((resolve) => {
        if (stream.readableEnded || stream.destroyed) {
          resolve();
          return;
        }
        stream.once("end", resolve);
        stream.once("close", resolve);
      });
      outStream.end();
      errStream.end();

      if (exitCode !== PASS_EXIT && exitCode !== THRESHOLD_FAIL_EXIT) {
        throw new Error(`k6 exited with code ${exitCode}`);
      }
      const summary = extractSummary(stdout);
      return { summary, exitCode };
    } finally {
      if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
      await container?.remove({ force: true }).catch(() => undefined);
    }
  }
}
