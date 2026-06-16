import type Docker from "dockerode"; // type-only — erased at build, safe when dockerode absent
import type { DockerConfig } from "./types";
import { DriverNotInstalledError } from "@/techs/contract";

// dockerode uses `module.exports = Dockerode` (CJS), so dynamic import() gives
// the class directly (no .default indirection) under the interop rules that tsc
// and Node use here.  We cache the constructor in a typed slot and cast once.
type DockerConstructor = new (opts?: object) => Docker;
let _dockerodeCtor: DockerConstructor | null = null;
async function getDockerode(): Promise<DockerConstructor> {
  try {
    if (!_dockerodeCtor) {
      const mod = await import("dockerode");
      // Under CJS interop the module itself IS the constructor; some bundlers
      // wrap it in {default:…} — handle both shapes.
      _dockerodeCtor = ((mod as unknown as { default?: unknown }).default ?? mod) as DockerConstructor;
    }
    return _dockerodeCtor;
  } catch {
    throw new DriverNotInstalledError("docker", "dockerode");
  }
}

export async function createDockerClient(config: DockerConfig): Promise<Docker> {
  const Dockerode = await getDockerode();
  if (config.mode === "tcp") {
    return new Dockerode({
      host: config.host,
      port: config.port,
      protocol: config.protocol ?? "http",
    });
  }
  return new Dockerode({
    socketPath: config.socketPath || "/var/run/docker.sock",
  });
}

export async function pingDocker(config: DockerConfig): Promise<{
  version: string;
  apiVersion: string;
  os: string;
  arch: string;
}> {
  const client = await createDockerClient(config);
  const version = await client.version();
  return {
    version: version.Version,
    apiVersion: version.ApiVersion,
    os: version.Os,
    arch: version.Arch,
  };
}

export interface ContainerSummary {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  ports: { ip?: string; private: number; public?: number; type: string }[];
}

export async function listContainers(
  config: DockerConfig,
  all: boolean
): Promise<ContainerSummary[]> {
  const client = await createDockerClient(config);
  const containers = await client.listContainers({ all });
  return containers.map((c) => ({
    id: c.Id,
    shortId: c.Id.slice(0, 12),
    name: (c.Names[0] || "").replace(/^\//, ""),
    image: c.Image,
    state: c.State,
    status: c.Status,
    created: c.Created,
    ports: (c.Ports || []).map((p) => ({
      ip: p.IP,
      private: p.PrivatePort,
      public: p.PublicPort,
      type: p.Type,
    })),
  }));
}

export interface ImageSummary {
  id: string;
  shortId: string;
  repoTags: string[];
  size: number;
  created: number;
}

export async function listImages(config: DockerConfig): Promise<ImageSummary[]> {
  const client = await createDockerClient(config);
  const images = await client.listImages();
  return images.map((i) => ({
    id: i.Id,
    shortId: i.Id.replace(/^sha256:/, "").slice(0, 12),
    repoTags: i.RepoTags ?? ["<none>:<none>"],
    size: i.Size,
    created: i.Created,
  }));
}

export interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint: string;
  created?: string;
  scope?: string;
}

export async function listVolumes(config: DockerConfig): Promise<VolumeSummary[]> {
  const client = await createDockerClient(config);
  const res = await client.listVolumes();
  return (res.Volumes || []).map((v) => {
    const created = (v as unknown as { CreatedAt?: string }).CreatedAt;
    return {
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
      created,
      scope: v.Scope,
    };
  });
}

export interface NetworkSummary {
  id: string;
  shortId: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
}

export async function listNetworks(
  config: DockerConfig
): Promise<NetworkSummary[]> {
  const client = await createDockerClient(config);
  const networks = await client.listNetworks();
  return networks.map((n) => ({
    id: n.Id,
    shortId: n.Id.slice(0, 12),
    name: n.Name,
    driver: n.Driver,
    scope: n.Scope,
    internal: Boolean(n.Internal),
  }));
}

export async function containerAction(
  config: DockerConfig,
  id: string,
  action: "start" | "stop" | "restart" | "remove" | "kill" | "pause" | "unpause"
): Promise<void> {
  const client = await createDockerClient(config);
  const container = client.getContainer(id);
  switch (action) {
    case "start":
      await container.start();
      return;
    case "stop":
      await container.stop();
      return;
    case "restart":
      await container.restart();
      return;
    case "kill":
      await container.kill();
      return;
    case "pause":
      await container.pause();
      return;
    case "unpause":
      await container.unpause();
      return;
    case "remove":
      await container.remove({ force: true });
      return;
  }
}

export async function inspectContainer(
  config: DockerConfig,
  id: string
): Promise<unknown> {
  const client = await createDockerClient(config);
  return client.getContainer(id).inspect();
}

export interface ReadLogsOptions {
  tail?: number | "all";
  since?: number; // unix seconds
  timestamps?: boolean;
}

export async function readContainerLogs(
  config: DockerConfig,
  id: string,
  tailOrOpts: number | ReadLogsOptions = 200
): Promise<string> {
  const opts: ReadLogsOptions =
    typeof tailOrOpts === "number" ? { tail: tailOrOpts } : tailOrOpts;
  const client = await createDockerClient(config);
  const container = client.getContainer(id);
  const buf = (await container.logs({
    stdout: true,
    stderr: true,
    // dockerode types want number; engine accepts "all"
    tail: (opts.tail ?? 200) as unknown as number,
    follow: false,
    timestamps: Boolean(opts.timestamps),
    since: opts.since,
  })) as unknown as Buffer;
  return decodeDockerStream(buf);
}

export interface StreamLogsOptions {
  tail?: number | "all";
  since?: number;
  timestamps?: boolean;
}

export interface StreamLogsHandle {
  destroy: () => void;
}

export interface LogLine {
  channel: "stdout" | "stderr";
  text: string;
}

export async function streamContainerLogs(
  config: DockerConfig,
  id: string,
  opts: StreamLogsOptions,
  onLine: (line: LogLine) => void,
  onError: (err: unknown) => void,
  onEnd: () => void
): Promise<StreamLogsHandle> {
  const client = await createDockerClient(config);
  const container = client.getContainer(id);
  const stream = (await container.logs({
    stdout: true,
    stderr: true,
    follow: true,
    tail: (opts.tail ?? 400) as unknown as number,
    timestamps: Boolean(opts.timestamps),
    since: opts.since,
  })) as unknown as NodeJS.ReadableStream;

  const makeWriter = (channel: "stdout" | "stderr") => {
    let buffer = "";
    const flushFinal = () => {
      if (buffer.length > 0) {
        onLine({ channel, text: buffer });
        buffer = "";
      }
    };
    return {
      write: (chunk: Buffer | string, _enc?: unknown, cb?: () => void) => {
        try {
          buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            // Strip trailing \r (Windows-style line endings in container output)
            onLine({
              channel,
              text: line.endsWith("\r") ? line.slice(0, -1) : line,
            });
          }
        } catch {
          // swallow — never let writer faults kill the stream
        }
        if (typeof cb === "function") cb();
        return true;
      },
      end: () => {
        flushFinal();
      },
      on: () => undefined,
      once: () => undefined,
      flushFinal,
    };
  };

  const stdoutWriter = makeWriter("stdout");
  const stderrWriter = makeWriter("stderr");

  client.modem.demuxStream(
    stream,
    stdoutWriter as unknown as NodeJS.WritableStream,
    stderrWriter as unknown as NodeJS.WritableStream
  );

  stream.once("end", () => {
    stdoutWriter.flushFinal();
    stderrWriter.flushFinal();
    onEnd();
  });
  stream.once("error", (err) => {
    onError(err);
  });

  return {
    destroy: () => {
      try {
        (stream as unknown as { destroy?: () => void }).destroy?.();
      } catch {
        // ignore
      }
    },
  };
}

function decodeDockerStream(input: Buffer): string {
  if (!Buffer.isBuffer(input)) return String(input);
  const out: string[] = [];
  let i = 0;
  while (i < input.length) {
    if (i + 8 > input.length) {
      out.push(input.subarray(i).toString("utf8"));
      break;
    }
    const header = input.subarray(i, i + 8);
    const isMultiplexed =
      (header[0] === 1 || header[0] === 2 || header[0] === 0) &&
      header[1] === 0 &&
      header[2] === 0 &&
      header[3] === 0;
    if (!isMultiplexed) {
      out.push(input.subarray(i).toString("utf8"));
      break;
    }
    const len = header.readUInt32BE(4);
    const payload = input.subarray(i + 8, i + 8 + len);
    out.push(payload.toString("utf8"));
    i += 8 + len;
  }
  return out.join("");
}

export interface CreateContainerInput {
  image: string;
  name?: string;
  command?: string;
  env?: { key: string; value: string }[];
  ports?: {
    container: number;
    host?: number;
    protocol?: "tcp" | "udp";
  }[];
  volumes?: { source: string; target: string; readOnly?: boolean }[];
  network?: string;
  restartPolicy?: "no" | "on-failure" | "always" | "unless-stopped";
  autoStart?: boolean;
}

export interface CreateContainerResult {
  id: string;
  warnings: string[];
}

export async function createContainer(
  config: DockerConfig,
  input: CreateContainerInput
): Promise<CreateContainerResult> {
  const client = await createDockerClient(config);
  const exposed: Record<string, object> = {};
  const portBindings: Record<string, { HostPort: string }[]> = {};
  for (const p of input.ports ?? []) {
    const proto = p.protocol ?? "tcp";
    const key = `${p.container}/${proto}`;
    exposed[key] = {};
    if (p.host) {
      portBindings[key] = [{ HostPort: String(p.host) }];
    }
  }

  const binds = (input.volumes ?? []).map(
    (v) => `${v.source}:${v.target}${v.readOnly ? ":ro" : ""}`
  );

  const env = (input.env ?? [])
    .filter((e) => e.key)
    .map((e) => `${e.key}=${e.value}`);

  const cmd = input.command?.trim()
    ? input.command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) =>
        s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
      ) ?? undefined
    : undefined;

  const created = await client.createContainer({
    name: input.name || undefined,
    Image: input.image,
    Cmd: cmd,
    Env: env.length ? env : undefined,
    ExposedPorts: Object.keys(exposed).length ? exposed : undefined,
    HostConfig: {
      PortBindings: Object.keys(portBindings).length ? portBindings : undefined,
      Binds: binds.length ? binds : undefined,
      RestartPolicy: input.restartPolicy
        ? { Name: input.restartPolicy }
        : undefined,
      NetworkMode: input.network || undefined,
    },
  });

  if (input.autoStart) {
    await created.start();
  }

  return {
    id: created.id,
    warnings: [],
  };
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
}

interface RawStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage?: number;
  };
  memory_stats: { usage?: number; limit?: number; stats?: { cache?: number } };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
  blkio_stats?: { io_service_bytes_recursive?: { op: string; value: number }[] };
  pids_stats?: { current?: number };
}

export async function readContainerStats(
  config: DockerConfig,
  id: string
): Promise<ContainerStats> {
  const client = await createDockerClient(config);
  const container = client.getContainer(id);
  const raw = (await container.stats({ stream: false })) as unknown as RawStats;

  const cpuDelta =
    raw.cpu_stats.cpu_usage.total_usage -
    raw.precpu_stats.cpu_usage.total_usage;
  const sysDelta =
    (raw.cpu_stats.system_cpu_usage ?? 0) -
    (raw.precpu_stats.system_cpu_usage ?? 0);
  const onlineCpus = raw.cpu_stats.online_cpus ?? 1;
  const cpuPercent =
    sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * onlineCpus * 100 : 0;

  const memUsage = raw.memory_stats.usage ?? 0;
  const memCache = raw.memory_stats.stats?.cache ?? 0;
  const memReal = Math.max(0, memUsage - memCache);
  const memLimit = raw.memory_stats.limit ?? 0;
  const memPercent = memLimit > 0 ? (memReal / memLimit) * 100 : 0;

  let netRx = 0;
  let netTx = 0;
  for (const n of Object.values(raw.networks ?? {})) {
    netRx += n.rx_bytes;
    netTx += n.tx_bytes;
  }

  let blockRead = 0;
  let blockWrite = 0;
  for (const b of raw.blkio_stats?.io_service_bytes_recursive ?? []) {
    if (b.op.toLowerCase() === "read") blockRead += b.value;
    if (b.op.toLowerCase() === "write") blockWrite += b.value;
  }

  return {
    cpuPercent,
    memoryUsage: memReal,
    memoryLimit: memLimit,
    memoryPercent: memPercent,
    networkRx: netRx,
    networkTx: netTx,
    blockRead,
    blockWrite,
    pids: raw.pids_stats?.current ?? 0,
  };
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export async function execInContainer(
  config: DockerConfig,
  id: string,
  command: string[]
): Promise<ExecResult> {
  const client = await createDockerClient(config);
  const container = client.getContainer(id);
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await exec.start({ hijack: true, stdin: false });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdoutWriter = {
    write: (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      return true;
    },
    end: () => undefined,
    on: () => undefined,
    once: () => undefined,
  };
  const stderrWriter = {
    write: (chunk: Buffer) => {
      stderrChunks.push(chunk);
      return true;
    },
    end: () => undefined,
    on: () => undefined,
    once: () => undefined,
  };

  await new Promise<void>((resolve, reject) => {
    client.modem.demuxStream(
      stream,
      stdoutWriter as unknown as NodeJS.WritableStream,
      stderrWriter as unknown as NodeJS.WritableStream
    );
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const inspect = await exec.inspect();
  return {
    exitCode: inspect.ExitCode ?? null,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

function escapeShell(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export interface StartTerminalInput {
  shell: string;
  cols: number;
  rows: number;
}

export async function startTerminal(
  config: DockerConfig,
  containerId: string,
  input: StartTerminalInput
): Promise<{
  exec: {
    resize: (opts: { h: number; w: number }) => Promise<unknown>;
    inspect: () => Promise<{ ExitCode?: number | null }>;
  };
  stream: NodeJS.ReadWriteStream;
}> {
  const client = await createDockerClient(config);
  const container = client.getContainer(containerId);
  const exec = await container.exec({
    Cmd: [input.shell],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: ["TERM=xterm-256color"],
  });
  const stream = await exec.start({
    hijack: true,
    stdin: true,
    Tty: true,
  });
  try {
    await exec.resize({ h: input.rows, w: input.cols });
  } catch {
    // some daemons don't support resize until first byte; ignore
  }
  return {
    exec: {
      resize: (opts) => exec.resize(opts),
      inspect: () =>
        exec.inspect() as unknown as Promise<{ ExitCode?: number | null }>,
    },
    stream: stream as unknown as NodeJS.ReadWriteStream,
  };
}

export interface FsEntry {
  type: "file" | "dir" | "link" | "other";
  name: string;
  size: number;
  mtime: number; // unix seconds
  target?: string; // symlink target if link
}

export interface FsListResult {
  path: string;
  entries: FsEntry[];
}

export async function fsList(
  config: DockerConfig,
  containerId: string,
  path: string
): Promise<FsListResult> {
  const safePath = path || "/";
  // Portable: works on busybox (alpine) and GNU coreutils. We avoid `find -printf`
  // which busybox doesn't support. For each direct child we emit:
  //   <type>\t<size>\t<mtime>\t<name>\t<symlink-target>\n
  const script = `
set -e
DIR=${escapeShell(safePath)}
[ -d "$DIR" ] || { echo "ERR: not a directory: $DIR" >&2; exit 1; }
cd "$DIR" || exit 1
for f in .* *; do
  [ "$f" = "." ] && continue
  [ "$f" = ".." ] && continue
  [ ! -e "$f" ] && [ ! -L "$f" ] && continue
  if [ -L "$f" ]; then
    t=l; sz=0; tgt=$(readlink "$f" 2>/dev/null || echo "")
  elif [ -d "$f" ]; then
    t=d; sz=0; tgt=""
  elif [ -f "$f" ]; then
    t=f
    sz=$(wc -c < "$f" 2>/dev/null || echo 0)
    sz=$(echo "$sz" | tr -d ' ')
    tgt=""
  else
    t=o; sz=0; tgt=""
  fi
  m=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
  printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$t" "$sz" "$m" "$f" "$tgt"
done
`;
  const cmd = ["/bin/sh", "-c", script];
  const exec = await execInContainer(config, containerId, cmd);
  if (exec.exitCode != null && exec.exitCode !== 0 && !exec.stdout.trim()) {
    throw new Error(
      exec.stderr.trim() ||
        `failed to list ${safePath} (path may not exist or is not a directory)`
    );
  }
  const entries: FsEntry[] = [];
  for (const line of exec.stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const [t, sizeStr, mtimeStr, name, linkTarget] = parts;
    const type: FsEntry["type"] =
      t === "f"
        ? "file"
        : t === "d"
          ? "dir"
          : t === "l"
            ? "link"
            : "other";
    entries.push({
      type,
      name,
      size: Number(sizeStr) || 0,
      mtime: Math.floor(Number(mtimeStr) || 0),
      target: linkTarget && linkTarget.trim() ? linkTarget : undefined,
    });
  }
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });
  return { path: safePath, entries };
}

export interface FsCatResult {
  path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  text: string;
}

const CAT_LIMIT = 65_536;

export async function fsCat(
  config: DockerConfig,
  containerId: string,
  path: string
): Promise<FsCatResult> {
  const cmd = [
    "/bin/sh",
    "-c",
    `head -c ${CAT_LIMIT + 1} ${escapeShell(path)} | base64 2>/dev/null`,
  ];
  const exec = await execInContainer(config, containerId, cmd);
  if (exec.exitCode != null && exec.exitCode !== 0) {
    throw new Error(exec.stderr.trim() || `failed to read ${path}`);
  }
  const b64 = exec.stdout.replace(/\s+/g, "");
  const buf = Buffer.from(b64, "base64");
  const truncated = buf.length > CAT_LIMIT;
  const slice = truncated ? buf.subarray(0, CAT_LIMIT) : buf;
  const sniff = slice.subarray(0, Math.min(4096, slice.length));
  const isBinary = sniff.includes(0);
  return {
    path,
    size: slice.length,
    truncated,
    binary: isBinary,
    text: isBinary ? "" : slice.toString("utf8"),
  };
}

export interface SystemInfo {
  serverVersion: string;
  apiVersion: string;
  os: string;
  osType: string;
  arch: string;
  kernel: string;
  cpus: number;
  memTotal: number;
  storageDriver: string;
  containers: number;
  containersRunning: number;
  containersPaused: number;
  containersStopped: number;
  images: number;
  rootDir: string;
  name: string;
}

export async function readSystemInfo(
  config: DockerConfig
): Promise<SystemInfo> {
  const client = await createDockerClient(config);
  const [info, version] = await Promise.all([
    client.info(),
    client.version(),
  ]);
  return {
    serverVersion: version.Version,
    apiVersion: version.ApiVersion,
    os: info.OperatingSystem,
    osType: info.OSType,
    arch: info.Architecture,
    kernel: info.KernelVersion,
    cpus: info.NCPU,
    memTotal: info.MemTotal,
    storageDriver: info.Driver,
    containers: info.Containers,
    containersRunning: info.ContainersRunning,
    containersPaused: info.ContainersPaused,
    containersStopped: info.ContainersStopped,
    images: info.Images,
    rootDir: info.DockerRootDir,
    name: info.Name,
  };
}

export interface PruneResult {
  itemsDeleted: string[];
  spaceReclaimed: number;
}

export async function pruneResource(
  config: DockerConfig,
  resource: "containers" | "images" | "volumes" | "networks" | "build"
): Promise<PruneResult> {
  const client = await createDockerClient(config);
  let raw: unknown;
  if (resource === "containers") raw = await client.pruneContainers();
  else if (resource === "images") raw = await client.pruneImages();
  else if (resource === "volumes") raw = await client.pruneVolumes();
  else if (resource === "networks") raw = await client.pruneNetworks();
  else raw = await client.pruneBuilder();
  const r = raw as {
    ContainersDeleted?: string[];
    ImagesDeleted?: { Deleted?: string }[];
    VolumesDeleted?: string[];
    NetworksDeleted?: string[];
    SpaceReclaimed?: number;
    CachesDeleted?: string[];
  };
  const itemsDeleted: string[] = [];
  if (r.ContainersDeleted) itemsDeleted.push(...r.ContainersDeleted);
  if (r.ImagesDeleted)
    itemsDeleted.push(
      ...r.ImagesDeleted.map((i) => i.Deleted).filter(
        (s): s is string => Boolean(s)
      )
    );
  if (r.VolumesDeleted) itemsDeleted.push(...r.VolumesDeleted);
  if (r.NetworksDeleted) itemsDeleted.push(...r.NetworksDeleted);
  if (r.CachesDeleted) itemsDeleted.push(...r.CachesDeleted);
  return {
    itemsDeleted,
    spaceReclaimed: r.SpaceReclaimed ?? 0,
  };
}

export interface RegistryAuth {
  username: string;
  password: string;
  serveraddress?: string;
  email?: string;
}

export async function pullImage(
  config: DockerConfig,
  ref: string,
  auth?: RegistryAuth
): Promise<void> {
  const client = await createDockerClient(config);
  await new Promise<void>((resolve, reject) => {
    const cb = (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) {
        reject(err || new Error("no pull stream"));
        return;
      }
      client.modem.followProgress(
        stream,
        (e: Error | null) => (e ? reject(e) : resolve()),
        () => undefined
      );
    };
    if (auth) {
      client.pull(ref, { authconfig: auth }, cb);
    } else {
      client.pull(ref, cb);
    }
  });
}

export async function eventsStream(
  config: DockerConfig
): Promise<NodeJS.ReadableStream> {
  const client = await createDockerClient(config);
  return new Promise((resolve, reject) => {
    client.getEvents({}, (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) reject(err || new Error("no event stream"));
      else resolve(stream);
    });
  });
}

// Build a minimal POSIX tar archive containing a single Dockerfile entry.
// Sufficient for `docker build` of a Dockerfile that doesn't pull in build
// context (no COPY/ADD).
export function dockerfileTarball(dockerfile: string): Buffer {
  const content = Buffer.from(dockerfile, "utf8");
  const octal = (n: number, w: number) => n.toString(8).padStart(w, "0");

  const header = Buffer.alloc(512);
  header.write("Dockerfile", 0, 100, "utf8");
  header.write(octal(0o644, 7) + "\0", 100, 8, "utf8");
  header.write(octal(0, 7) + "\0", 108, 8, "utf8");
  header.write(octal(0, 7) + "\0", 116, 8, "utf8");
  header.write(octal(content.length, 11) + "\0", 124, 12, "utf8");
  header.write(octal(Math.floor(Date.now() / 1000), 11) + "\0", 136, 12, "utf8");
  header.write("        ", 148, 8, "utf8"); // checksum placeholder
  header.write("0", 156, 1, "utf8"); // regular file
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(octal(sum, 6) + "\0 ", 148, 8, "utf8");

  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(padded);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

export async function buildImageStream(
  config: DockerConfig,
  dockerfile: string,
  tag: string
): Promise<NodeJS.ReadableStream> {
  const { Readable } = await import("node:stream");
  const client = await createDockerClient(config);
  const tar = dockerfileTarball(dockerfile);
  const tarStream = Readable.from(tar);
  return new Promise((resolve, reject) => {
    client.buildImage(
      tarStream,
      { t: tag, dockerfile: "Dockerfile" },
      (err: Error | null, stream?: NodeJS.ReadableStream) => {
        if (err || !stream) reject(err || new Error("no build stream"));
        else resolve(stream);
      }
    );
  });
}

export interface PullProgressEvent {
  status?: string;
  id?: string;
  progressDetail?: { current?: number; total?: number };
  progress?: string;
  error?: string;
}

export async function pullImageStream(
  config: DockerConfig,
  ref: string,
  auth?: RegistryAuth
): Promise<NodeJS.ReadableStream> {
  const client = await createDockerClient(config);
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) reject(err || new Error("no pull stream"));
      else resolve(stream);
    };
    if (auth) {
      client.pull(ref, { authconfig: auth }, cb);
    } else {
      client.pull(ref, cb);
    }
  });
}

export async function removeImage(
  config: DockerConfig,
  id: string,
  force = false
): Promise<void> {
  const client = await createDockerClient(config);
  await client.getImage(id).remove({ force });
}

export async function createVolume(
  config: DockerConfig,
  name: string,
  driver = "local"
): Promise<void> {
  const client = await createDockerClient(config);
  await client.createVolume({ Name: name, Driver: driver });
}

export async function removeVolume(
  config: DockerConfig,
  name: string,
  force = false
): Promise<void> {
  const client = await createDockerClient(config);
  await client.getVolume(name).remove({ force });
}

export async function removeNetwork(
  config: DockerConfig,
  id: string
): Promise<void> {
  const client = await createDockerClient(config);
  await client.getNetwork(id).remove();
}

export async function connectContainerToNetwork(
  config: DockerConfig,
  networkId: string,
  containerId: string,
  aliases?: string[]
): Promise<void> {
  const client = await createDockerClient(config);
  await client.getNetwork(networkId).connect({
    Container: containerId,
    EndpointConfig: aliases?.length ? { Aliases: aliases } : undefined,
  });
}

export async function disconnectContainerFromNetwork(
  config: DockerConfig,
  networkId: string,
  containerId: string,
  force = false
): Promise<void> {
  const client = await createDockerClient(config);
  await client.getNetwork(networkId).disconnect({
    Container: containerId,
    Force: force,
  });
}

export interface CreateNetworkInput {
  name: string;
  driver?: string;
  internal?: boolean;
  attachable?: boolean;
  subnet?: string;
  gateway?: string;
}

export async function createNetwork(
  config: DockerConfig,
  input: CreateNetworkInput
): Promise<{ id: string }> {
  const client = await createDockerClient(config);
  const ipam =
    input.subnet || input.gateway
      ? {
          Driver: "default",
          Config: [
            {
              Subnet: input.subnet || undefined,
              Gateway: input.gateway || undefined,
            },
          ],
        }
      : undefined;
  const created = await client.createNetwork({
    Name: input.name,
    Driver: input.driver || "bridge",
    Internal: Boolean(input.internal),
    Attachable: Boolean(input.attachable),
    IPAM: ipam,
  });
  return { id: created.id };
}
