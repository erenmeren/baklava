import amqp from "amqplib";
import type { RabbitConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// URL / mgmt helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildAmqpUrl(config: RabbitConfig): string {
  const scheme = config.tls ? "amqps" : "amqp";
  const user = encodeURIComponent(config.user || "guest");
  const pass = encodeURIComponent(config.password ?? "");
  // RabbitMQ vhost is path-encoded. "/" is the default and must be percent-
  // encoded; everything else gets its leading "/" stripped and encoded.
  const vhost = config.vhost ?? "/";
  const vhostPath =
    vhost === "/" ? "" : encodeURIComponent(vhost.replace(/^\//, ""));
  return `${scheme}://${user}:${pass}@${config.host}:${config.port}/${vhostPath}`;
}

function mgmtBase(config: RabbitConfig): string {
  const port = config.managementPort ?? 15672;
  const scheme = config.tls ? "https" : "http";
  return `${scheme}://${config.host}:${port}`;
}

function mgmtHeaders(config: RabbitConfig): Record<string, string> {
  const token = Buffer.from(
    `${config.user || "guest"}:${config.password ?? ""}`
  ).toString("base64");
  return {
    authorization: `Basic ${token}`,
    accept: "application/json",
  };
}

async function mgmtGet<T>(config: RabbitConfig, path: string): Promise<T> {
  const url = `${mgmtBase(config)}${path}`;
  const res = await fetch(url, {
    headers: mgmtHeaders(config),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Management API ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`
    );
  }
  return (await res.json()) as T;
}

async function mgmtRequest<T>(
  config: RabbitConfig,
  path: string,
  init: { method: string; body?: unknown }
): Promise<T | undefined> {
  const url = `${mgmtBase(config)}${path}`;
  const headers: Record<string, string> = {
    ...mgmtHeaders(config),
  };
  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(url, {
    method: init.method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Management API ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`
    );
  }
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function vhostSegment(vhost: string): string {
  return encodeURIComponent(vhost || "/");
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe
// ─────────────────────────────────────────────────────────────────────────────

export interface RabbitProbeResult {
  amqpReachable: boolean;
  managementReachable: boolean;
  rabbitVersion?: string;
  erlangVersion?: string;
  clusterName?: string;
  managementError?: string;
}

export async function probeRabbit(
  config: RabbitConfig
): Promise<RabbitProbeResult> {
  // Always probe AMQP — that's the actual data plane.
  const url = buildAmqpUrl(config);
  const conn = await amqp.connect(url);
  try {
    const ch = await conn.createChannel();
    await ch.close().catch(() => undefined);
  } finally {
    await conn.close().catch(() => undefined);
  }

  // Best-effort: hit the management API for version/cluster info. If the
  // management plugin isn't enabled, surface that gracefully rather than
  // failing the whole probe — listings simply won't work until it's on.
  const result: RabbitProbeResult = {
    amqpReachable: true,
    managementReachable: false,
  };
  try {
    const overview = await mgmtGet<{
      rabbitmq_version?: string;
      erlang_version?: string;
      cluster_name?: string;
    }>(config, "/api/overview");
    result.managementReachable = true;
    result.rabbitVersion = overview.rabbitmq_version;
    result.erlangVersion = overview.erlang_version;
    result.clusterName = overview.cluster_name;
  } catch (err) {
    result.managementError = err instanceof Error ? err.message : String(err);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview (mission control)
// ─────────────────────────────────────────────────────────────────────────────

export interface RabbitNode {
  name: string;
  running: boolean;
  type?: string;
  memUsed?: number;
  diskFree?: number;
  diskFreeLimit?: number;
  fdUsed?: number;
  fdTotal?: number;
}

export interface RabbitOverview {
  rabbitVersion?: string;
  erlangVersion?: string;
  clusterName?: string;
  totalMessages: number;
  messagesReady: number;
  messagesUnacknowledged: number;
  totalQueues: number;
  totalConsumers: number;
  totalChannels: number;
  totalConnections: number;
  totalExchanges: number;
  publishRate: number;
  deliverRate: number;
  ackRate: number;
  nodes: RabbitNode[];
  topQueues: {
    name: string;
    vhost: string;
    messages: number;
    state: string;
  }[];
}

interface OverviewResponse {
  rabbitmq_version?: string;
  erlang_version?: string;
  cluster_name?: string;
  queue_totals?: {
    messages?: number;
    messages_ready?: number;
    messages_unacknowledged?: number;
  };
  object_totals?: {
    consumers?: number;
    queues?: number;
    exchanges?: number;
    connections?: number;
    channels?: number;
  };
  message_stats?: {
    publish_details?: { rate?: number };
    deliver_details?: { rate?: number };
    ack_details?: { rate?: number };
  };
}

interface NodeResponse {
  name: string;
  running?: boolean;
  type?: string;
  mem_used?: number;
  disk_free?: number;
  disk_free_limit?: number;
  fd_used?: number;
  fd_total?: number;
}

interface QueueResponse {
  name: string;
  vhost: string;
  messages?: number;
  messages_ready?: number;
  messages_unacknowledged?: number;
  consumers?: number;
  state?: string;
  durable?: boolean;
  auto_delete?: boolean;
  exclusive?: boolean;
  node?: string;
  type?: string;
  arguments?: Record<string, unknown>;
  memory?: number;
  message_bytes?: number;
}

export async function getRabbitOverview(
  config: RabbitConfig
): Promise<RabbitOverview> {
  const [overview, nodes, queues] = await Promise.all([
    mgmtGet<OverviewResponse>(config, "/api/overview"),
    mgmtGet<NodeResponse[]>(config, "/api/nodes").catch(() => [] as NodeResponse[]),
    mgmtGet<QueueResponse[]>(
      config,
      `/api/queues/${vhostSegment(config.vhost ?? "/")}`
    ).catch(() => [] as QueueResponse[]),
  ]);

  const topQueues = [...queues]
    .sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0))
    .slice(0, 5)
    .map((q) => ({
      name: q.name,
      vhost: q.vhost,
      messages: q.messages ?? 0,
      state: q.state ?? "unknown",
    }));

  return {
    rabbitVersion: overview.rabbitmq_version,
    erlangVersion: overview.erlang_version,
    clusterName: overview.cluster_name,
    totalMessages: overview.queue_totals?.messages ?? 0,
    messagesReady: overview.queue_totals?.messages_ready ?? 0,
    messagesUnacknowledged: overview.queue_totals?.messages_unacknowledged ?? 0,
    totalQueues: overview.object_totals?.queues ?? queues.length,
    totalConsumers: overview.object_totals?.consumers ?? 0,
    totalChannels: overview.object_totals?.channels ?? 0,
    totalConnections: overview.object_totals?.connections ?? 0,
    totalExchanges: overview.object_totals?.exchanges ?? 0,
    publishRate: overview.message_stats?.publish_details?.rate ?? 0,
    deliverRate: overview.message_stats?.deliver_details?.rate ?? 0,
    ackRate: overview.message_stats?.ack_details?.rate ?? 0,
    nodes: nodes.map((n) => ({
      name: n.name,
      running: Boolean(n.running),
      type: n.type,
      memUsed: n.mem_used,
      diskFree: n.disk_free,
      diskFreeLimit: n.disk_free_limit,
      fdUsed: n.fd_used,
      fdTotal: n.fd_total,
    })),
    topQueues,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queues
// ─────────────────────────────────────────────────────────────────────────────

export interface RabbitQueueSummary {
  name: string;
  vhost: string;
  messages: number;
  messagesReady: number;
  messagesUnacknowledged: number;
  consumers: number;
  state: string;
  durable: boolean;
  autoDelete: boolean;
  exclusive: boolean;
  node?: string;
  type?: string;
  memory?: number;
  messageBytes?: number;
}

export async function listRabbitQueues(
  config: RabbitConfig
): Promise<RabbitQueueSummary[]> {
  const queues = await mgmtGet<QueueResponse[]>(
    config,
    `/api/queues/${vhostSegment(config.vhost ?? "/")}`
  );
  return queues
    .map<RabbitQueueSummary>((q) => ({
      name: q.name,
      vhost: q.vhost,
      messages: q.messages ?? 0,
      messagesReady: q.messages_ready ?? 0,
      messagesUnacknowledged: q.messages_unacknowledged ?? 0,
      consumers: q.consumers ?? 0,
      state: q.state ?? "unknown",
      durable: Boolean(q.durable),
      autoDelete: Boolean(q.auto_delete),
      exclusive: Boolean(q.exclusive),
      node: q.node,
      type: q.type,
      memory: q.memory,
      messageBytes: q.message_bytes,
    }))
    .sort((a, b) => b.messages - a.messages);
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue detail / bindings / consumers / message peek
// ─────────────────────────────────────────────────────────────────────────────

interface RateBlock {
  rate?: number;
}

interface QueueDetailResponse extends QueueResponse {
  message_stats?: {
    publish?: number;
    publish_details?: RateBlock;
    deliver?: number;
    deliver_details?: RateBlock;
    deliver_get?: number;
    deliver_get_details?: RateBlock;
    ack?: number;
    ack_details?: RateBlock;
    redeliver?: number;
    redeliver_details?: RateBlock;
  };
  consumer_details?: RabbitConsumerDetailResponse[];
  policy?: string;
  idle_since?: string;
  recoverable_slaves?: string[];
  slave_nodes?: string[];
}

interface RabbitConsumerDetailResponse {
  consumer_tag: string;
  ack_required?: boolean;
  active?: boolean;
  exclusive?: boolean;
  prefetch_count?: number;
  arguments?: Record<string, unknown>;
  channel_details?: {
    name?: string;
    connection_name?: string;
    peer_host?: string;
    peer_port?: number;
    user?: string;
  };
}

export interface RabbitQueueDetail {
  queue: QueueDetailResponse;
  node?: string;
  vhost: string;
}

export async function getRabbitQueue(
  config: RabbitConfig,
  name: string
): Promise<RabbitQueueDetail> {
  const vhost = config.vhost ?? "/";
  const queue = await mgmtGet<QueueDetailResponse>(
    config,
    `/api/queues/${vhostSegment(vhost)}/${encodeURIComponent(name)}`
  );
  return { queue, node: queue.node, vhost };
}

export interface RabbitBinding {
  source: string;
  vhost: string;
  destination: string;
  destinationType: string;
  routingKey: string;
  arguments: Record<string, unknown>;
  propertiesKey?: string;
}

interface BindingResponse {
  source: string;
  vhost: string;
  destination: string;
  destination_type: string;
  routing_key: string;
  arguments?: Record<string, unknown>;
  properties_key?: string;
}

export async function getRabbitQueueBindings(
  config: RabbitConfig,
  name: string
): Promise<RabbitBinding[]> {
  const vhost = config.vhost ?? "/";
  const bindings = await mgmtGet<BindingResponse[]>(
    config,
    `/api/queues/${vhostSegment(vhost)}/${encodeURIComponent(name)}/bindings`
  );
  return bindings.map((b) => ({
    source: b.source,
    vhost: b.vhost,
    destination: b.destination,
    destinationType: b.destination_type,
    routingKey: b.routing_key,
    arguments: b.arguments ?? {},
    propertiesKey: b.properties_key,
  }));
}

export interface RabbitConsumerDetail {
  consumerTag: string;
  ackRequired: boolean;
  active: boolean;
  exclusive: boolean;
  prefetchCount: number;
  channelName?: string;
  connectionName?: string;
  peerHost?: string;
  peerPort?: number;
  user?: string;
  arguments: Record<string, unknown>;
}

export async function getRabbitQueueConsumers(
  config: RabbitConfig,
  name: string
): Promise<RabbitConsumerDetail[]> {
  const detail = await getRabbitQueue(config, name);
  const list = detail.queue.consumer_details ?? [];
  return list.map<RabbitConsumerDetail>((c) => ({
    consumerTag: c.consumer_tag,
    ackRequired: Boolean(c.ack_required),
    active: Boolean(c.active),
    exclusive: Boolean(c.exclusive),
    prefetchCount: c.prefetch_count ?? 0,
    channelName: c.channel_details?.name,
    connectionName: c.channel_details?.connection_name,
    peerHost: c.channel_details?.peer_host,
    peerPort: c.channel_details?.peer_port,
    user: c.channel_details?.user,
    arguments: c.arguments ?? {},
  }));
}

export interface RabbitPeekedMessage {
  payload: string;
  payloadBytes?: number;
  payloadEncoding: string;
  routingKey: string;
  exchange: string;
  redelivered: boolean;
  properties: Record<string, unknown>;
  messageCount?: number;
}

interface PeekedMessageResponse {
  payload: string;
  payload_bytes?: number;
  payload_encoding: string;
  routing_key: string;
  exchange: string;
  redelivered: boolean;
  properties?: Record<string, unknown>;
  message_count?: number;
}

export async function peekRabbitMessages(
  config: RabbitConfig,
  name: string,
  count: number,
  requeue = true
): Promise<RabbitPeekedMessage[]> {
  const vhost = config.vhost ?? "/";
  const safeCount = Math.min(Math.max(1, Math.floor(count)), 100);
  const body = {
    count: safeCount,
    ackmode: requeue ? "ack_requeue_true" : "ack_requeue_false",
    encoding: "auto",
    truncate: 50_000,
  };
  const result = await mgmtRequest<PeekedMessageResponse[]>(
    config,
    `/api/queues/${vhostSegment(vhost)}/${encodeURIComponent(name)}/get`,
    { method: "POST", body }
  );
  const list = result ?? [];
  return list.map<RabbitPeekedMessage>((m) => ({
    payload: m.payload,
    payloadBytes: m.payload_bytes,
    payloadEncoding: m.payload_encoding,
    routingKey: m.routing_key,
    exchange: m.exchange,
    redelivered: Boolean(m.redelivered),
    properties: m.properties ?? {},
    messageCount: m.message_count,
  }));
}

export async function purgeRabbitQueue(
  config: RabbitConfig,
  name: string
): Promise<void> {
  const vhost = config.vhost ?? "/";
  await mgmtRequest<unknown>(
    config,
    `/api/queues/${vhostSegment(vhost)}/${encodeURIComponent(name)}/contents`,
    { method: "DELETE" }
  );
}

export async function deleteRabbitQueue(
  config: RabbitConfig,
  name: string
): Promise<void> {
  const vhost = config.vhost ?? "/";
  await mgmtRequest<unknown>(
    config,
    `/api/queues/${vhostSegment(vhost)}/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
}
