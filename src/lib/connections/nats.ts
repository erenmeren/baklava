import {
  connect,
  RetentionPolicy,
  StorageType,
  type ConnectionOptions,
  type NatsConnection,
  type JetStreamManager,
} from "nats";
import type { NatsConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Connection helper
// ─────────────────────────────────────────────────────────────────────────────

function buildOptions(config: NatsConfig): ConnectionOptions {
  const opts: ConnectionOptions = {
    servers: config.servers,
    timeout: 5000,
    reconnect: false,
    name: "baklava",
  };
  if (config.token) {
    opts.token = config.token;
  } else if (config.user) {
    opts.user = config.user;
    opts.pass = config.password;
  }
  return opts;
}

async function withConnection<T>(
  config: NatsConfig,
  fn: (nc: NatsConnection) => Promise<T>
): Promise<T> {
  const nc = await connect(buildOptions(config));
  try {
    return await fn(nc);
  } finally {
    // drain() flushes outbound messages first, then closes — preferred for
    // shutdown vs close() which is abrupt.
    await nc.drain().catch(() => undefined);
  }
}

async function getJsm(nc: NatsConnection): Promise<JetStreamManager | null> {
  try {
    return await nc.jetstreamManager();
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe
// ─────────────────────────────────────────────────────────────────────────────

export interface NatsProbeResult {
  serverName?: string;
  serverVersion?: string;
  host?: string;
  port?: number;
  jetstream: boolean;
  cluster?: string;
  maxPayload?: number;
}

export async function probeNats(config: NatsConfig): Promise<NatsProbeResult> {
  return withConnection(config, async (nc) => {
    const info = nc.info;
    return {
      serverName: info?.server_name,
      serverVersion: info?.version,
      host: info?.host,
      port: info?.port,
      jetstream: Boolean(info?.jetstream),
      cluster: info?.cluster,
      maxPayload: info?.max_payload,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────

export interface NatsOverview {
  serverName?: string;
  serverId?: string;
  serverVersion?: string;
  host?: string;
  port?: number;
  cluster?: string;
  protoVersion?: number;
  maxPayload?: number;
  jetstreamEnabled: boolean;
  clientId?: number;
  connectUrls: string[];
  account: {
    enabled: boolean;
    memory: number;
    storage: number;
    streams: number;
    consumers: number;
    apiTotal?: number;
    apiErrors?: number;
    domain?: string;
    limits?: {
      maxMemory: number;
      maxStorage: number;
      maxStreams: number;
      maxConsumers: number;
    };
  };
  topStreams: {
    name: string;
    messages: number;
    bytes: number;
    consumers: number;
  }[];
}

export async function getNatsOverview(
  config: NatsConfig
): Promise<NatsOverview> {
  return withConnection(config, async (nc) => {
    const info = nc.info;
    const overview: NatsOverview = {
      serverName: info?.server_name,
      serverId: info?.server_id,
      serverVersion: info?.version,
      host: info?.host,
      port: info?.port,
      cluster: info?.cluster,
      protoVersion: info?.proto,
      maxPayload: info?.max_payload,
      jetstreamEnabled: Boolean(info?.jetstream),
      clientId: info?.client_id,
      connectUrls: info?.connect_urls ?? [],
      account: {
        enabled: false,
        memory: 0,
        storage: 0,
        streams: 0,
        consumers: 0,
      },
      topStreams: [],
    };

    const jsm = await getJsm(nc);
    if (!jsm) return overview;

    try {
      const acct = await jsm.getAccountInfo();
      overview.account = {
        enabled: true,
        memory: acct.memory,
        storage: acct.storage,
        streams: acct.streams,
        consumers: acct.consumers,
        apiTotal: acct.api?.total,
        apiErrors: acct.api?.errors,
        domain: acct.domain,
        limits: acct.limits
          ? {
              maxMemory: acct.limits.max_memory,
              maxStorage: acct.limits.max_storage,
              maxStreams: acct.limits.max_streams,
              maxConsumers: acct.limits.max_consumers,
            }
          : undefined,
      };
    } catch {
      // JetStream might be advertised but not authorised for this account.
    }

    try {
      const lister = jsm.streams.list();
      const streams: { name: string; messages: number; bytes: number; consumers: number }[] = [];
      for await (const s of lister) {
        streams.push({
          name: s.config.name,
          messages: Number(s.state.messages) || 0,
          bytes: Number(s.state.bytes) || 0,
          consumers: s.state.consumer_count ?? 0,
        });
      }
      overview.topStreams = streams
        .sort((a, b) => b.messages - a.messages)
        .slice(0, 5);
    } catch {
      // ignore — overview.topStreams stays empty
    }

    return overview;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams (JetStream)
// ─────────────────────────────────────────────────────────────────────────────

export interface NatsStreamSummary {
  name: string;
  subjects: string[];
  messages: number;
  bytes: number;
  consumerCount: number;
  retention: RetentionPolicy | string;
  storage: StorageType | string;
  replicas: number;
  /** Max age in nanoseconds (0 = unlimited). */
  maxAge: number;
  maxMsgs: number;
  maxBytes: number;
  firstSeq: number;
  lastSeq: number;
  created?: string;
}

export interface NatsStreamListResult {
  jetstreamEnabled: boolean;
  streams: NatsStreamSummary[];
  error?: string;
}

export async function listNatsStreams(
  config: NatsConfig
): Promise<NatsStreamListResult> {
  return withConnection(config, async (nc) => {
    const info = nc.info;
    const jetstreamEnabled = Boolean(info?.jetstream);
    if (!jetstreamEnabled) {
      return { jetstreamEnabled: false, streams: [] };
    }

    const jsm = await getJsm(nc);
    if (!jsm) {
      return {
        jetstreamEnabled: false,
        streams: [],
        error: "JetStream API not reachable",
      };
    }

    try {
      const lister = jsm.streams.list();
      const out: NatsStreamSummary[] = [];
      for await (const s of lister) {
        out.push({
          name: s.config.name,
          subjects: s.config.subjects ?? [],
          messages: Number(s.state.messages) || 0,
          bytes: Number(s.state.bytes) || 0,
          consumerCount: s.state.consumer_count ?? 0,
          retention: s.config.retention,
          storage: s.config.storage,
          replicas: s.config.num_replicas ?? 1,
          maxAge: Number(s.config.max_age) || 0,
          maxMsgs: Number(s.config.max_msgs) || 0,
          maxBytes: Number(s.config.max_bytes) || 0,
          firstSeq: Number(s.state.first_seq) || 0,
          lastSeq: Number(s.state.last_seq) || 0,
          created: s.created,
        });
      }
      out.sort((a, b) => b.messages - a.messages);
      return { jetstreamEnabled: true, streams: out };
    } catch (err) {
      return {
        jetstreamEnabled: true,
        streams: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
