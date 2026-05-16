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

// ─────────────────────────────────────────────────────────────────────────────
// Stream detail / consumers / message peek
// ─────────────────────────────────────────────────────────────────────────────

export interface NatsStreamPeer {
  name: string;
  current: boolean;
  offline: boolean;
  lag?: number;
  active?: number;
}

export interface NatsStreamDetail {
  name: string;
  created?: string;
  description?: string;
  config: {
    subjects: string[];
    retention: string;
    storage: string;
    discard: string;
    maxAge: number;
    maxMsgs: number;
    maxMsgsPerSubject: number;
    maxBytes: number;
    maxMsgSize: number;
    maxConsumers: number;
    numReplicas: number;
    duplicateWindow: number;
    sealed: boolean;
    denyDelete: boolean;
    denyPurge: boolean;
    allowRollup: boolean;
    firstSeq: number;
  };
  state: {
    messages: number;
    bytes: number;
    firstSeq: number;
    lastSeq: number;
    firstTs?: string;
    lastTs?: string;
    consumerCount: number;
    numSubjects: number;
    numDeleted: number;
    subjects?: Record<string, number>;
  };
  cluster?: {
    name?: string;
    leader?: string;
    replicas: NatsStreamPeer[];
  };
}

function streamInfoToDetail(s: import("nats").StreamInfo): NatsStreamDetail {
  return {
    name: s.config.name,
    created: s.created,
    description: s.config.description,
    config: {
      subjects: s.config.subjects ?? [],
      retention: String(s.config.retention),
      storage: String(s.config.storage),
      discard: String(s.config.discard),
      maxAge: Number(s.config.max_age) || 0,
      maxMsgs: Number(s.config.max_msgs) || 0,
      maxMsgsPerSubject: Number(s.config.max_msgs_per_subject) || 0,
      maxBytes: Number(s.config.max_bytes) || 0,
      maxMsgSize: Number(s.config.max_msg_size) || 0,
      maxConsumers: Number(s.config.max_consumers) || 0,
      numReplicas: Number(s.config.num_replicas) || 1,
      duplicateWindow: Number(s.config.duplicate_window) || 0,
      sealed: Boolean(s.config.sealed),
      denyDelete: Boolean(s.config.deny_delete),
      denyPurge: Boolean(s.config.deny_purge),
      allowRollup: Boolean(s.config.allow_rollup_hdrs),
      firstSeq: Number(s.config.first_seq) || 0,
    },
    state: {
      messages: Number(s.state.messages) || 0,
      bytes: Number(s.state.bytes) || 0,
      firstSeq: Number(s.state.first_seq) || 0,
      lastSeq: Number(s.state.last_seq) || 0,
      firstTs: s.state.first_ts,
      lastTs: s.state.last_ts,
      consumerCount: s.state.consumer_count ?? 0,
      numSubjects: s.state.num_subjects ?? 0,
      numDeleted: s.state.num_deleted ?? 0,
      subjects: s.state.subjects,
    },
    cluster: s.cluster
      ? {
          name: s.cluster.name,
          leader: s.cluster.leader,
          replicas: (s.cluster.replicas ?? []).map((r) => ({
            name: r.name,
            current: r.current,
            offline: r.offline,
            lag: r.lag,
            active: Number(r.active) || 0,
          })),
        }
      : undefined,
  };
}

export async function getNatsStream(
  config: NatsConfig,
  name: string
): Promise<NatsStreamDetail> {
  return withConnection(config, async (nc) => {
    const jsm = await getJsm(nc);
    if (!jsm) throw new Error("JetStream API not reachable");
    // Request subject counts (capped server-side by num_subjects setting).
    let info: import("nats").StreamInfo;
    try {
      info = await jsm.streams.info(name, { subjects_filter: ">" });
    } catch {
      info = await jsm.streams.info(name);
    }
    return streamInfoToDetail(info);
  });
}

export interface NatsConsumerSummary {
  name: string;
  streamName: string;
  durable: boolean;
  durableName?: string;
  ackPolicy: string;
  deliverPolicy: string;
  replayPolicy: string;
  filterSubject?: string;
  numPending: number;
  numAckPending: number;
  numRedelivered: number;
  numWaiting: number;
  lastDeliveredSeq: number;
  ackFloorSeq: number;
  created?: string;
  pushBound: boolean;
  paused: boolean;
}

export async function getNatsConsumers(
  config: NatsConfig,
  streamName: string
): Promise<NatsConsumerSummary[]> {
  return withConnection(config, async (nc) => {
    const jsm = await getJsm(nc);
    if (!jsm) throw new Error("JetStream API not reachable");
    const lister = jsm.consumers.list(streamName);
    const out: NatsConsumerSummary[] = [];
    for await (const c of lister) {
      out.push({
        name: c.name,
        streamName: c.stream_name,
        durable: Boolean(c.config.durable_name),
        durableName: c.config.durable_name,
        ackPolicy: String(c.config.ack_policy),
        deliverPolicy: String(c.config.deliver_policy),
        replayPolicy: String(c.config.replay_policy),
        filterSubject: c.config.filter_subject,
        numPending: Number(c.num_pending) || 0,
        numAckPending: c.num_ack_pending ?? 0,
        numRedelivered: c.num_redelivered ?? 0,
        numWaiting: c.num_waiting ?? 0,
        lastDeliveredSeq: Number(c.delivered?.stream_seq) || 0,
        ackFloorSeq: Number(c.ack_floor?.stream_seq) || 0,
        created: c.created,
        pushBound: Boolean(c.push_bound),
        paused: Boolean(c.paused),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });
}

export interface NatsPeekedMessage {
  seq: number;
  subject: string;
  ts?: string;
  headers: Record<string, string[]>;
  payload: string;
  /** Base64-encoded raw payload when binary; null when text. */
  payloadBase64?: string;
  size: number;
  isUtf8: boolean;
}

function decodePayload(data: Uint8Array): {
  payload: string;
  payloadBase64?: string;
  isUtf8: boolean;
} {
  // Try UTF-8 decode strictly. If it succeeds without replacement chars,
  // use the text; otherwise fall back to base64 so the client can render
  // hex/preview.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return { payload: text, isUtf8: true };
  } catch {
    return {
      payload: "",
      payloadBase64: Buffer.from(data).toString("base64"),
      isUtf8: false,
    };
  }
}

function headersToRecord(
  hdrs: import("nats").MsgHdrs | undefined
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!hdrs) return out;
  try {
    for (const key of hdrs.keys()) {
      out[key] = hdrs.values(key);
    }
  } catch {
    // older versions may not expose keys() in the same way; ignore.
  }
  return out;
}

export async function peekNatsMessages(
  config: NatsConfig,
  streamName: string,
  count: number,
  startSeq?: number
): Promise<NatsPeekedMessage[]> {
  const safeCount = Math.min(Math.max(1, Math.floor(count)), 100);
  return withConnection(config, async (nc) => {
    const jsm = await getJsm(nc);
    if (!jsm) throw new Error("JetStream API not reachable");

    // Discover boundaries so we know where to start.
    const info = await jsm.streams.info(streamName);
    const firstSeq = Number(info.state.first_seq) || 0;
    const lastSeq = Number(info.state.last_seq) || 0;
    if (lastSeq <= 0 || firstSeq <= 0) return [];

    const upper = startSeq && startSeq > 0 ? Math.min(startSeq, lastSeq) : lastSeq;
    const out: NatsPeekedMessage[] = [];
    let seq = upper;
    let misses = 0;
    while (out.length < safeCount && seq >= firstSeq && misses < 200) {
      try {
        const m = await jsm.streams.getMessage(streamName, { seq });
        const decoded = decodePayload(m.data);
        out.push({
          seq: Number(m.seq) || seq,
          subject: m.subject,
          ts: m.timestamp,
          headers: headersToRecord(m.header),
          payload: decoded.payload,
          payloadBase64: decoded.payloadBase64,
          size: m.data.byteLength,
          isUtf8: decoded.isUtf8,
        });
      } catch {
        // Missing/deleted seq — keep walking, but bound the scan.
        misses++;
      }
      seq--;
    }
    return out;
  });
}

export async function purgeNatsStream(
  config: NatsConfig,
  name: string
): Promise<void> {
  await withConnection(config, async (nc) => {
    const jsm = await getJsm(nc);
    if (!jsm) throw new Error("JetStream API not reachable");
    await jsm.streams.purge(name);
  });
}

export async function deleteNatsStream(
  config: NatsConfig,
  name: string
): Promise<void> {
  await withConnection(config, async (nc) => {
    const jsm = await getJsm(nc);
    if (!jsm) throw new Error("JetStream API not reachable");
    await jsm.streams.delete(name);
  });
}
