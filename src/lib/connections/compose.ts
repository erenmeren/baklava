import "server-only";
import YAML from "yaml";
import { createDockerClient, pullImageStream } from "./docker";
import { findCredForRef } from "./registries";
import type { DockerConfig } from "./types";

export const STACK_LABEL = "baklava.stack.name";
export const SERVICE_LABEL = "baklava.stack.service";
export const ROLE_LABEL = "baklava.stack.role"; // network | volume | container

export interface ComposePort {
  host?: number;
  container: number;
  protocol: "tcp" | "udp";
}

export interface ComposeMount {
  source: string; // named volume name (already prefixed) or host path
  target: string;
  readOnly: boolean;
  type: "volume" | "bind";
}

export interface ComposeService {
  name: string;
  image: string;
  containerName?: string;
  command?: string;
  env: { key: string; value: string }[];
  ports: ComposePort[];
  mounts: ComposeMount[];
  networks: string[];
  dependsOn: string[];
  restart?: "no" | "on-failure" | "always" | "unless-stopped";
}

export interface ComposeNetwork {
  name: string; // already prefixed with stack
  alias: string; // declared name (may equal "default")
  driver: string;
  external: boolean;
}

export interface ComposeVolume {
  name: string; // already prefixed with stack
  alias: string; // declared name
  driver: string;
  external: boolean;
}

export interface ParsedCompose {
  stack: string;
  services: ComposeService[];
  networks: ComposeNetwork[];
  volumes: ComposeVolume[];
  warnings: string[];
}

export interface ComposeError {
  message: string;
  path?: string[];
}

export class ComposeParseError extends Error {
  errors: ComposeError[];
  constructor(errors: ComposeError[]) {
    super(errors.map((e) => e.message).join("; "));
    this.errors = errors;
  }
}

const RESTART_VALUES = new Set([
  "no",
  "on-failure",
  "always",
  "unless-stopped",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function parseEnv(raw: unknown): { key: string; value: string }[] {
  if (raw == null) return [];
  const out: { key: string; value: string }[] = [];
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (typeof e !== "string") continue;
      const eq = e.indexOf("=");
      if (eq < 0) out.push({ key: e, value: "" });
      else out.push({ key: e.slice(0, eq), value: e.slice(eq + 1) });
    }
    return out;
  }
  if (isPlainObject(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      out.push({ key: k, value: v == null ? "" : String(v) });
    }
  }
  return out;
}

function parsePorts(raw: unknown, errors: ComposeError[]): ComposePort[] {
  if (raw == null) return [];
  const out: ComposePort[] = [];
  for (const item of asArray(raw)) {
    if (typeof item === "number") {
      out.push({ container: item, protocol: "tcp" });
      continue;
    }
    if (typeof item !== "string") {
      // long-form object port spec
      if (isPlainObject(item)) {
        const target = Number(item.target);
        const published =
          item.published != null ? Number(item.published) : undefined;
        const protocol = (item.protocol === "udp" ? "udp" : "tcp") as
          | "tcp"
          | "udp";
        if (!Number.isFinite(target)) continue;
        out.push({ container: target, host: published, protocol });
      }
      continue;
    }
    // string forms:
    //   "8080"
    //   "8080:80"
    //   "127.0.0.1:8080:80"
    //   "8080:80/udp"
    let s = item;
    let protocol: "tcp" | "udp" = "tcp";
    const slash = s.lastIndexOf("/");
    if (slash >= 0) {
      const proto = s.slice(slash + 1);
      if (proto === "tcp" || proto === "udp") protocol = proto;
      s = s.slice(0, slash);
    }
    const parts = s.split(":");
    if (parts.length === 1) {
      const c = Number(parts[0]);
      if (Number.isFinite(c)) out.push({ container: c, protocol });
    } else if (parts.length === 2) {
      const h = Number(parts[0]);
      const c = Number(parts[1]);
      if (Number.isFinite(c))
        out.push({ container: c, host: Number.isFinite(h) ? h : undefined, protocol });
    } else if (parts.length === 3) {
      // ip:host:container — we ignore the bind IP for now
      const h = Number(parts[1]);
      const c = Number(parts[2]);
      if (Number.isFinite(c))
        out.push({
          container: c,
          host: Number.isFinite(h) ? h : undefined,
          protocol,
        });
    } else {
      errors.push({ message: `unrecognized port spec "${item}"` });
    }
  }
  return out;
}

function parseMounts(
  raw: unknown,
  serviceName: string,
  declaredVolumes: Set<string>,
  stack: string,
  errors: ComposeError[]
): ComposeMount[] {
  if (raw == null) return [];
  const out: ComposeMount[] = [];
  for (const item of asArray(raw)) {
    if (typeof item === "string") {
      // "src:target" or "src:target:ro" or just "target"
      const parts = item.split(":");
      let source: string | undefined;
      let target: string;
      let readOnly = false;
      if (parts.length === 1) {
        // anonymous volume → target only; we'll create a volume keyed by service+target
        target = parts[0];
        source = `${stack}_${serviceName}_${target.replace(/\W+/g, "_")}`;
      } else if (parts.length >= 2) {
        source = parts[0];
        target = parts[1];
        if (parts[2] === "ro") readOnly = true;
      } else {
        continue;
      }
      const type: ComposeMount["type"] = source.startsWith("/")
        ? "bind"
        : "volume";
      const mappedSource =
        type === "volume" && declaredVolumes.has(source)
          ? `${stack}_${source}`
          : source;
      out.push({ source: mappedSource, target, readOnly, type });
    } else if (isPlainObject(item)) {
      const type = item.type === "bind" ? "bind" : "volume";
      const source = String(item.source ?? "");
      const target = String(item.target ?? "");
      const readOnly = Boolean(item.read_only ?? item.readOnly);
      if (!target) continue;
      const mappedSource =
        type === "volume" && declaredVolumes.has(source)
          ? `${stack}_${source}`
          : source;
      out.push({ source: mappedSource, target, readOnly, type });
    } else {
      errors.push({
        message: `unrecognized volume entry on service "${serviceName}"`,
      });
    }
  }
  return out;
}

function parseDependsOn(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  if (isPlainObject(raw)) return Object.keys(raw);
  return [];
}

function parseServiceNetworks(
  raw: unknown,
  declared: Set<string>,
  stack: string
): string[] {
  if (raw == null) return [`${stack}_default`];
  if (Array.isArray(raw)) {
    return raw
      .filter((n): n is string => typeof n === "string")
      .map((n) => (declared.has(n) ? `${stack}_${n}` : n));
  }
  if (isPlainObject(raw)) {
    return Object.keys(raw).map((n) =>
      declared.has(n) ? `${stack}_${n}` : n
    );
  }
  return [`${stack}_default`];
}

export function parseCompose(stack: string, source: string): ParsedCompose {
  const errors: ComposeError[] = [];
  const warnings: string[] = [];

  if (!/^[a-z0-9][a-z0-9_-]{0,30}$/i.test(stack)) {
    throw new ComposeParseError([
      {
        message:
          "stack name must be 1-31 chars, start with letter/digit, only letters/digits/_/-",
      },
    ]);
  }

  let doc: unknown;
  try {
    doc = YAML.parse(source);
  } catch (err) {
    throw new ComposeParseError([
      { message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` },
    ]);
  }

  if (!isPlainObject(doc)) {
    throw new ComposeParseError([{ message: "compose file must be an object" }]);
  }

  const servicesRaw = (doc as Record<string, unknown>).services;
  if (!isPlainObject(servicesRaw) || Object.keys(servicesRaw).length === 0) {
    throw new ComposeParseError([{ message: "no services defined" }]);
  }

  // Top-level networks
  const networksDecl = isPlainObject(doc.networks)
    ? (doc.networks as Record<string, unknown>)
    : {};
  const declaredNetworks = new Set(Object.keys(networksDecl));
  const networks: ComposeNetwork[] = [];
  for (const [alias, raw] of Object.entries(networksDecl)) {
    const meta = isPlainObject(raw) ? raw : {};
    const external = Boolean(meta.external);
    networks.push({
      name: external ? alias : `${stack}_${alias}`,
      alias,
      driver: typeof meta.driver === "string" ? meta.driver : "bridge",
      external,
    });
  }
  // Default network if none declared
  if (networks.length === 0) {
    networks.push({
      name: `${stack}_default`,
      alias: "default",
      driver: "bridge",
      external: false,
    });
  } else if (!declaredNetworks.has("default")) {
    networks.push({
      name: `${stack}_default`,
      alias: "default",
      driver: "bridge",
      external: false,
    });
  }

  // Top-level volumes
  const volumesDecl = isPlainObject(doc.volumes)
    ? (doc.volumes as Record<string, unknown>)
    : {};
  const declaredVolumes = new Set(Object.keys(volumesDecl));
  const volumes: ComposeVolume[] = [];
  for (const [alias, raw] of Object.entries(volumesDecl)) {
    const meta = isPlainObject(raw) ? raw : {};
    const external = Boolean(meta.external);
    volumes.push({
      name: external ? alias : `${stack}_${alias}`,
      alias,
      driver: typeof meta.driver === "string" ? meta.driver : "local",
      external,
    });
  }

  // Services
  const services: ComposeService[] = [];
  for (const [name, raw] of Object.entries(servicesRaw)) {
    if (!isPlainObject(raw)) {
      errors.push({ message: `service "${name}" must be an object` });
      continue;
    }
    if (raw.build && !raw.image) {
      errors.push({
        message: `service "${name}" uses build context — Baklava only supports image: services for now`,
      });
      continue;
    }
    if (typeof raw.image !== "string") {
      errors.push({ message: `service "${name}" missing image:` });
      continue;
    }
    const restart =
      typeof raw.restart === "string" && RESTART_VALUES.has(raw.restart)
        ? (raw.restart as ComposeService["restart"])
        : undefined;

    const command =
      typeof raw.command === "string"
        ? raw.command
        : Array.isArray(raw.command)
          ? raw.command
              .map((c) =>
                typeof c === "string" && /\s/.test(c) ? `"${c}"` : String(c)
              )
              .join(" ")
          : undefined;

    const containerName =
      typeof raw.container_name === "string" ? raw.container_name : undefined;

    const svc: ComposeService = {
      name,
      image: raw.image,
      containerName,
      command,
      env: parseEnv(raw.environment),
      ports: parsePorts(raw.ports, errors),
      mounts: parseMounts(raw.volumes, name, declaredVolumes, stack, errors),
      networks: parseServiceNetworks(raw.networks, declaredNetworks, stack),
      dependsOn: parseDependsOn(raw.depends_on),
      restart,
    };
    services.push(svc);
  }

  // Validate depends_on refs
  const serviceNames = new Set(services.map((s) => s.name));
  for (const s of services) {
    for (const d of s.dependsOn) {
      if (!serviceNames.has(d)) {
        warnings.push(
          `service "${s.name}" depends_on "${d}" which is not defined; ignoring`
        );
      }
    }
    s.dependsOn = s.dependsOn.filter((d) => serviceNames.has(d));
  }

  if (errors.length) throw new ComposeParseError(errors);

  return { stack, services, networks, volumes, warnings };
}

// Topological sort of services by depends_on. Cycles → fall back to declaration order.
export function deployOrder(services: ComposeService[]): ComposeService[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const out: ComposeService[] = [];
  const visit = (name: string) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) return; // cycle: skip
    visiting.add(name);
    const s = byName.get(name);
    if (!s) {
      visiting.delete(name);
      return;
    }
    for (const d of s.dependsOn) visit(d);
    visiting.delete(name);
    visited.add(name);
    out.push(s);
  };
  for (const s of services) visit(s.name);
  return out;
}

// ─── Deployment ─────────────────────────────────────────────────────────

export type DeployEvent =
  | { type: "phase"; phase: "networks" | "volumes" | "pull" | "create" | "start" | "done" }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "service"; service: string; status: string }
  | { type: "error"; message: string };

export async function deployStack(
  config: DockerConfig,
  connectionId: string,
  parsed: ParsedCompose,
  emit: (event: DeployEvent) => void
): Promise<void> {
  const client = await createDockerClient(config);
  const { stack, services, networks, volumes } = parsed;

  emit({ type: "phase", phase: "networks" });
  for (const net of networks) {
    if (net.external) {
      emit({
        type: "log",
        level: "info",
        message: `using external network ${net.name}`,
      });
      continue;
    }
    try {
      const existing = await client.listNetworks({
        filters: JSON.stringify({ name: [net.name] }),
      });
      const found = existing.find((n) => n.Name === net.name);
      if (found) {
        emit({
          type: "log",
          level: "info",
          message: `network ${net.name} already exists, reusing`,
        });
        continue;
      }
      await client.createNetwork({
        Name: net.name,
        Driver: net.driver,
        Labels: {
          [STACK_LABEL]: stack,
          [ROLE_LABEL]: "network",
        },
      });
      emit({
        type: "log",
        level: "info",
        message: `created network ${net.name}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `network ${net.name}: ${msg}` });
      throw err;
    }
  }

  emit({ type: "phase", phase: "volumes" });
  for (const vol of volumes) {
    if (vol.external) {
      emit({
        type: "log",
        level: "info",
        message: `using external volume ${vol.name}`,
      });
      continue;
    }
    try {
      const list = await client.listVolumes({
        filters: JSON.stringify({ name: [vol.name] }),
      });
      const found = (list.Volumes || []).find((v) => v.Name === vol.name);
      if (found) {
        emit({
          type: "log",
          level: "info",
          message: `volume ${vol.name} already exists, reusing`,
        });
        continue;
      }
      await client.createVolume({
        Name: vol.name,
        Driver: vol.driver,
        Labels: {
          [STACK_LABEL]: stack,
          [ROLE_LABEL]: "volume",
        },
      });
      emit({
        type: "log",
        level: "info",
        message: `created volume ${vol.name}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `volume ${vol.name}: ${msg}` });
      throw err;
    }
  }

  emit({ type: "phase", phase: "pull" });
  const uniqueImages = Array.from(new Set(services.map((s) => s.image)));
  for (const ref of uniqueImages) {
    emit({ type: "log", level: "info", message: `pulling ${ref}` });
    try {
      const cred = findCredForRef(connectionId, ref);
      const auth = cred
        ? {
            username: cred.username,
            password: cred.password,
            serveraddress: cred.serverAddress,
            email: cred.email,
          }
        : undefined;
      const stream = await pullImageStream(config, ref, auth);
      await new Promise<void>((resolve, reject) => {
        client.modem.followProgress(
          stream,
          (e: Error | null) => (e ? reject(e) : resolve()),
          () => undefined
        );
      });
      emit({ type: "log", level: "info", message: `pulled ${ref}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({
        type: "log",
        level: "warn",
        message: `pull failed for ${ref}: ${msg} — will try with local image`,
      });
    }
  }

  emit({ type: "phase", phase: "create" });
  const ordered = deployOrder(services);
  const containerIdsByService = new Map<string, string>();
  for (const svc of ordered) {
    emit({ type: "service", service: svc.name, status: "creating" });
    const exposed: Record<string, object> = {};
    const portBindings: Record<string, { HostPort: string }[]> = {};
    for (const p of svc.ports) {
      const key = `${p.container}/${p.protocol}`;
      exposed[key] = {};
      if (p.host != null) {
        portBindings[key] = [{ HostPort: String(p.host) }];
      }
    }
    const binds = svc.mounts.map(
      (m) => `${m.source}:${m.target}${m.readOnly ? ":ro" : ""}`
    );
    const env = svc.env.map((e) => `${e.key}=${e.value}`);
    const cmd = svc.command?.trim()
      ? svc.command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) =>
          s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
        ) ?? undefined
      : undefined;
    const labels: Record<string, string> = {
      [STACK_LABEL]: stack,
      [SERVICE_LABEL]: svc.name,
      [ROLE_LABEL]: "container",
    };
    const containerName =
      svc.containerName || `${stack}_${svc.name}`;

    // Remove any pre-existing container with the same name from a prior deploy
    try {
      const existing = await client.listContainers({
        all: true,
        filters: JSON.stringify({ name: [`^/${containerName}$`] }),
      });
      for (const c of existing) {
        const cont = client.getContainer(c.Id);
        try {
          await cont.stop({ t: 5 });
        } catch {
          // already stopped
        }
        await cont.remove({ force: true });
        emit({
          type: "log",
          level: "info",
          message: `removed stale container ${containerName}`,
        });
      }
    } catch {
      // ignore
    }

    try {
      const created = await client.createContainer({
        name: containerName,
        Image: svc.image,
        Cmd: cmd,
        Env: env.length ? env : undefined,
        Labels: labels,
        ExposedPorts: Object.keys(exposed).length ? exposed : undefined,
        HostConfig: {
          PortBindings: Object.keys(portBindings).length
            ? portBindings
            : undefined,
          Binds: binds.length ? binds : undefined,
          RestartPolicy: svc.restart ? { Name: svc.restart } : undefined,
          NetworkMode: svc.networks[0],
        },
      });
      containerIdsByService.set(svc.name, created.id);

      // Connect any additional networks beyond the primary
      for (const net of svc.networks.slice(1)) {
        try {
          await client.getNetwork(net).connect({ Container: created.id });
        } catch (err) {
          emit({
            type: "log",
            level: "warn",
            message: `attach ${svc.name} to ${net}: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      emit({ type: "service", service: svc.name, status: "created" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({
        type: "error",
        message: `create ${svc.name}: ${msg}`,
      });
      throw err;
    }
  }

  emit({ type: "phase", phase: "start" });
  for (const svc of ordered) {
    const id = containerIdsByService.get(svc.name);
    if (!id) continue;
    try {
      await client.getContainer(id).start();
      emit({ type: "service", service: svc.name, status: "running" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({
        type: "error",
        message: `start ${svc.name}: ${msg}`,
      });
      throw err;
    }
  }

  emit({ type: "phase", phase: "done" });
}

// ─── Listing / detail / teardown ────────────────────────────────────────

export interface StackSummary {
  name: string;
  services: number;
  running: number;
  total: number;
  createdAt: number;
}

export interface StackServiceDetail {
  service: string;
  containerId: string;
  containerName: string;
  image: string;
  state: string;
  status: string;
  ports: { host?: number; container: number; protocol: string }[];
  createdAt: number;
}

export interface StackDetail {
  name: string;
  services: StackServiceDetail[];
  networks: { name: string; id: string; driver: string }[];
  volumes: { name: string; driver: string; mountpoint: string }[];
  createdAt: number;
}

export async function listStacks(
  config: DockerConfig
): Promise<StackSummary[]> {
  const client = await createDockerClient(config);
  const all = await client.listContainers({
    all: true,
    filters: JSON.stringify({ label: [STACK_LABEL] }),
  });
  const byStack = new Map<
    string,
    { total: number; running: number; createdAt: number }
  >();
  for (const c of all) {
    const stack = c.Labels?.[STACK_LABEL];
    if (!stack) continue;
    const cur = byStack.get(stack) ?? {
      total: 0,
      running: 0,
      createdAt: c.Created,
    };
    cur.total += 1;
    if (c.State === "running") cur.running += 1;
    cur.createdAt = Math.min(cur.createdAt, c.Created);
    byStack.set(stack, cur);
  }
  return Array.from(byStack.entries())
    .map(([name, s]) => ({
      name,
      services: s.total,
      total: s.total,
      running: s.running,
      createdAt: s.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getStack(
  config: DockerConfig,
  name: string
): Promise<StackDetail | null> {
  const client = await createDockerClient(config);
  const containers = await client.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${STACK_LABEL}=${name}`] }),
  });
  if (containers.length === 0) return null;
  const services: StackServiceDetail[] = containers.map((c) => ({
    service: c.Labels?.[SERVICE_LABEL] || "",
    containerId: c.Id,
    containerName: (c.Names[0] || "").replace(/^\//, ""),
    image: c.Image,
    state: c.State,
    status: c.Status,
    ports: (c.Ports || []).map((p) => ({
      host: p.PublicPort,
      container: p.PrivatePort,
      protocol: p.Type,
    })),
    createdAt: c.Created,
  }));
  services.sort((a, b) => a.service.localeCompare(b.service));

  const allNetworks = await client.listNetworks({
    filters: JSON.stringify({ label: [`${STACK_LABEL}=${name}`] }),
  });
  const allVolumes = await client.listVolumes({
    filters: JSON.stringify({ label: [`${STACK_LABEL}=${name}`] }),
  });
  return {
    name,
    services,
    networks: allNetworks.map((n) => ({
      name: n.Name,
      id: n.Id,
      driver: n.Driver,
    })),
    volumes: (allVolumes.Volumes || []).map((v) => ({
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
    })),
    createdAt: services.reduce(
      (min, s) => Math.min(min, s.createdAt),
      services[0]?.createdAt ?? Date.now() / 1000
    ),
  };
}

export async function stackAction(
  config: DockerConfig,
  name: string,
  action: "start" | "stop" | "restart"
): Promise<{ services: number }> {
  const client = await createDockerClient(config);
  const containers = await client.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${STACK_LABEL}=${name}`] }),
  });
  for (const c of containers) {
    const cont = client.getContainer(c.Id);
    try {
      if (action === "start" && c.State !== "running") await cont.start();
      else if (action === "stop" && c.State === "running") await cont.stop();
      else if (action === "restart") await cont.restart();
    } catch {
      // continue best-effort
    }
  }
  return { services: containers.length };
}

export async function teardownStack(
  config: DockerConfig,
  name: string,
  options: { removeVolumes?: boolean } = {}
): Promise<void> {
  const client = await createDockerClient(config);
  const containers = await client.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${STACK_LABEL}=${name}`] }),
  });
  for (const c of containers) {
    const cont = client.getContainer(c.Id);
    try {
      await cont.remove({ force: true });
    } catch {
      // already gone
    }
  }
  const networks = await client.listNetworks({
    filters: JSON.stringify({ label: [`${STACK_LABEL}=${name}`] }),
  });
  for (const n of networks) {
    try {
      await client.getNetwork(n.Id).remove();
    } catch {
      // may have other attachments; ignore
    }
  }
  if (options.removeVolumes) {
    const volumes = await client.listVolumes({
      filters: JSON.stringify({ label: [`${STACK_LABEL}=${name}`] }),
    });
    for (const v of volumes.Volumes || []) {
      try {
        await client.getVolume(v.Name).remove({ force: true });
      } catch {
        // ignore
      }
    }
  }
}
