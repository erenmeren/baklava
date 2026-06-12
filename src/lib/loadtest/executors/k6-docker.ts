import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { createDockerClient } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import type { Executor, Progress, RawRunOutput, RunOpts } from "../executor";
import { SUMMARY_END, SUMMARY_START } from "../script-gen";

const ANSI_RE = /\x1B\[[0-9;?]*[A-Za-z]/g;

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
  const json = stdout.slice(start + SUMMARY_START.length, end).replace(ANSI_RE, "");
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

    // Write the script to a temp dir before creating the container so the
    // file is guaranteed present when k6 starts (eliminates the stdin-delivery
    // race that caused exit 107 ~1-in-3 runs).
    const workDir = mkdtempSync(join(tmpdir(), "baklava-loadtest-"));
    writeFileSync(join(workDir, "script.js"), script, "utf8");

    let container:
      | Awaited<ReturnType<ReturnType<typeof createDockerClient>["createContainer"]>>
      | undefined;
    let onAbort: (() => void) | undefined;

    try {
      container = await client.createContainer({
        Image: K6_IMAGE,
        Cmd: ["run", "/work/script.js"],
        Env: envArr,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        HostConfig: {
          ExtraHosts: ["host.docker.internal:host-gateway"],
          Binds: [`${workDir}:/work:ro`],
        },
      });

      let output = "";
      let lineBuf = "";
      const emitLines = (text: string) => {
        lineBuf += text;
        const parts = lineBuf.split(/\r\n|\r|\n/);
        lineBuf = parts.pop() ?? "";
        for (const raw of parts) {
          const clean = raw.replace(ANSI_RE, "").trim();
          if (clean) onProgress({ line: clean });
        }
      };

      // Attach before start so no output is missed.
      // Cast to Duplex: the @types/dockerode overload always returns
      // ReadWriteStream, but the runtime object is a net.Socket / Duplex and
      // has destroy / readableEnded / destroyed — needed for the drain below.
      // With Tty:true the stream is a single combined channel — no demuxing needed.
      const stream = (await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      })) as Duplex;
      stream.on("data", (c: Buffer) => {
        const text = c.toString("utf8");
        output += text;
        emitLines(text);
      });
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

      const status = await container.wait({ abortSignal: opts.signal });
      const exitCode = status.StatusCode as number;

      // container.wait() and the attach socket are separate connections; the
      // daemon can signal exit before Node has dispatched the final data
      // chunks. Wait for the attach stream to close so demuxStream has flushed
      // the complete summary into `stdout`.
      await new Promise<void>((resolve) => {
        if (stream.readableEnded || stream.destroyed) {
          resolve();
          return;
        }
        stream.once("end", resolve);
        stream.once("close", resolve);
      });

      if (exitCode !== PASS_EXIT && exitCode !== THRESHOLD_FAIL_EXIT) {
        throw new Error(`k6 exited with code ${exitCode}`);
      }
      const summary = extractSummary(output);
      return { summary, exitCode };
    } finally {
      if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
      await container?.remove({ force: true }).catch(() => undefined);
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}
