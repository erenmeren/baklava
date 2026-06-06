# AI Tools — Phase 2: Mongo, Redis, Kafka, Kubernetes (Design Spec)

- **Status:** Approved (brainstorm) — ready for implementation planning
- **Date:** 2026-06-06
- **Builds on:** the AI assistant + the SQL-family tools (Phase 1). Same pattern:
  category-tagged thin wrappers over existing drivers, registered in `BUILDERS` +
  `AI_SUPPORTED_TECHS`; gate/permissions/addressing/persistence are tech-agnostic.

## Summary

Add full read/write/destructive AI tools for **MongoDB, Redis, Kafka, and
Kubernetes**, bringing AI coverage to all 8 supported techs. Each tool is gated
by the existing per-connection permission policy. Kubernetes gains two small new
driver helpers (one-shot logs + delete) and a per-connection **"reveal secret
values"** toggle (default off) that controls whether `k8s_get_yaml` returns
Secret values.

## Goals

- The assistant can inspect and act on Mongo / Redis / Kafka / Kubernetes
  connections, category-tagged so the existing gate enforces read/write/destructive.
- Per-tech safety nuances handled deliberately (below).
- Cluster secret values stay out of the LLM transcript unless explicitly opted in.

## Non-goals

- Container/pod `exec` as an AI tool (excluded for Docker in Phase 1, excluded for
  Kubernetes here).
- Raw Redis command passthrough (typed tools only).
- Blob storage (R2/MinIO/S3) AI tools.
- Streaming tools (Kafka tail, Redis pub/sub, K8s log *follow*) — one-shot reads only.

---

## New driver helpers (Kubernetes only)

Mongo / Redis / Kafka reuse existing driver functions unchanged. Kubernetes needs:

- `src/lib/connections/kubernetes.ts → getPodLogs(connectionId, cfg, namespace, podName, opts: { tailLines?: number; container?: string }): Promise<string>` — one-shot, **non-following** log read (collect `streamPodLogs` with `follow: false` into a capped string, or call the K8s log API directly). Caps output (e.g. tail ≤ 2000 lines, byte cap).
- `src/lib/connections/kubernetes.ts → deleteResource(connectionId, cfg, kind, namespace, name): Promise<void>` — delete a namespaced/cluster resource via `KubernetesObjectApi.delete` using the existing `resolveKind` map. (The driver currently has no delete.)

Both follow the existing `bundleFor` client-cache pattern in that file.

---

## Tool catalogs

Builder signature is `(connectionId, config, policy?) => AiTool[]` (see "Secret
toggle" for why `policy` is threaded). Mongo/Redis/Kubernetes driver fns take
`connectionId` first (client cache); Kafka fns take `config`.

### Mongo — `src/lib/ai/tools/mongo.ts`  (args use EJSON strings where noted)
| Tool | Category | Wraps |
|---|---|---|
| `mongo_list_databases` | read | `listDatabases` |
| `mongo_list_collections` | read | `listCollections(db)` |
| `mongo_find` | read | `findDocuments` (filter/projection/sort/skip/limit EJSON) |
| `mongo_aggregate` | read | `runAggregate` — **reject pipelines containing a `$out` or `$merge` stage** |
| `mongo_sample_schema` | read | `sampleSchema` |
| `mongo_list_indexes` | read | `listIndexes` |
| `mongo_insert_document` | write | `insertDocument` (EJSON doc) |
| `mongo_replace_document` | write | `replaceDocument` (filter + doc EJSON) |
| `mongo_create_index` | write | `createIndex` |
| `mongo_create_collection` | write | `createCollectionOp` |
| `mongo_delete_document` | destructive | `deleteDocument` (filter EJSON, deletes one) |
| `mongo_drop_collection` | destructive | `dropCollectionOp` |
| `mongo_drop_index` | destructive | `dropIndex` |

`mongo_aggregate` parses the EJSON pipeline and, if any stage object has an `$out`
or `$merge` key, throws "aggregate is read-only: `$out`/`$merge` not allowed" —
keeping it a read tool (those stages write a collection).

### Redis — `src/lib/ai/tools/redis.ts`  (typed only; no raw command)
| Tool | Category | Wraps |
|---|---|---|
| `redis_list_keys` | read | `listKeys({ pattern, db })` |
| `redis_get_key` | read | `getKey(key, db?)` |
| `redis_info` | read | `info(section?)` |
| `redis_set_string` | write | `setStringValue(key, value, db?)` |
| `redis_set_ttl` | write | `setTtl(key, ttlSeconds, db?)` |
| `redis_delete_key` | destructive | `delKey(key, db?)` |

No `runCommand`, no FLUSH (no driver fn) — keeps the surface clean and classifiable.

### Kafka — `src/lib/ai/tools/kafka.ts`  (driver fns take `config`)
| Tool | Category | Wraps |
|---|---|---|
| `kafka_list_topics` | read | `listTopicsWithStats` |
| `kafka_describe_topic` | read | `describeTopic` |
| `kafka_fetch_messages` | read | `fetchMessages` (topic, limit, fromBeginning) |
| `kafka_list_consumer_groups` | read | `listConsumerGroupsWithLag` |
| `kafka_describe_consumer_group` | read | `describeConsumerGroup` |
| `kafka_cluster_summary` | read | `getClusterSummary` |
| `kafka_produce_message` | write | `produceMessage` |
| `kafka_create_topic` | write | `createTopic` |
| `kafka_alter_topic_config` | write | `alterTopicConfig` |
| `kafka_add_partitions` | write | `addTopicPartitions` |
| `kafka_delete_topic` | destructive | `deleteTopic` |
| `kafka_empty_topic` | destructive | `emptyTopic` |
| `kafka_reset_group_offsets` | destructive | `resetGroupOffsets` (can skip/replay data) |
| `kafka_delete_consumer_group` | destructive | `deleteConsumerGroup` |

### Kubernetes — `src/lib/ai/tools/kubernetes.ts`  (exec excluded)
| Tool | Category | Wraps |
|---|---|---|
| `k8s_list_pods` | read | `listPods(namespace?)` |
| `k8s_list_deployments` | read | `listDeployments` |
| `k8s_list_services` | read | `listServices` |
| `k8s_list_configmaps` | read | `listConfigMaps` |
| `k8s_list_secrets` | read | `listSecrets` (names + key counts only — driver already returns no values) |
| `k8s_list_namespaces` | read | `listNamespaces` |
| `k8s_pod_logs` | read | new `getPodLogs` (one-shot, tail-bounded) |
| `k8s_get_yaml` | read | `readResourceYaml` — **redacts Secret `data`/`stringData` unless the policy opts in** |
| `k8s_apply_yaml` | write | `replaceResourceYaml` |
| `k8s_delete_resource` | destructive | new `deleteResource` |

`k8s_get_yaml`: when `kind` is `Secret` and `policy.allowK8sSecretValues !== true`,
strip `data` and `stringData` from the parsed manifest before returning (AI sees
the secret's keys/shape, never values).

---

## Kubernetes "reveal secret values" toggle

- `src/lib/ai/permissions.ts` — `PermissionPolicy` gains `allowK8sSecretValues?: boolean`
  (default `false`/undefined). `isAllowed` / `needsApproval` are unchanged (it's
  not a category).
- `src/lib/ai/policy-store.ts` — already stores the whole policy object; no change
  beyond the new field flowing through.
- `src/app/api/ai/connections/[id]/policy/route.ts` (PUT) — accept and persist
  `allowK8sSecretValues: Boolean(body.allowK8sSecretValues)`.
- `src/lib/ai/tools/registry.ts` — widen `Builder` to
  `(connectionId: string, config: unknown, policy: PermissionPolicy) => AiTool[]`
  and pass `policy` when invoking (existing `(id, cfg)` builders remain assignable —
  fewer params is fine). `buildConversationTools` already has each connection's
  policy; `buildTools` already receives it.
- `src/components/ai/working-set.tsx` — the policy popover shows a 4th switch,
  **"Reveal secret values"**, rendered **only when the connection's tech is
  `kubernetes`**. `PolicyView` gains the optional field; `changePolicy` PUTs it.

`kubernetesTools(connectionId, config, policy)` reads `policy.allowK8sSecretValues`
to decide redaction in `k8s_get_yaml`.

## Wiring

- `src/lib/ai/tools/registry.ts` `BUILDERS` gains `mongo`, `redis`, `kafka`,
  `kubernetes`.
- `src/lib/ai/supported.ts` `AI_SUPPORTED_TECHS` becomes all 8:
  `["postgres","docker","mysql","sqlserver","mongo","redis","kafka","kubernetes"]`.

The `/` picker, model picker, chips + policy popover, approval cards, and audit log
then cover the four new techs automatically.

## Safety recap

- Per-connection policy + approval is the backstop for every write/destructive tool.
- **Mongo:** `mongo_aggregate` rejects `$out`/`$merge` (no silent writes); EJSON parsed via the driver's existing `parseEjson`.
- **Redis:** typed tools only — no raw command, so every action is cleanly categorized.
- **Kafka:** `fetch_messages` uses the driver's ephemeral consumer group (deleted in `finally`); destructive ops (`delete_topic`/`empty_topic`/`reset_group_offsets`/`delete_consumer_group`) gated.
- **Kubernetes:** `exec` excluded entirely; Secret values redacted by default behind an explicit per-connection opt-in; `delete_resource` is destructive.
- Identifiers/values go through each driver's existing guards; the merged-tool `connection` enum prevents cross-connection bleed.

## Testing

- **Unit per tool module** (vi.mock the driver): category tags + each tool delegates to the right driver fn with the right args (mirrors `tools/postgres.test.ts`).
- **Mongo aggregate guard:** `mongo_aggregate.execute` with a pipeline containing `{ $out: "x" }` (and `{ $merge: … }`) rejects without calling `runAggregate`; a normal pipeline delegates.
- **K8s secret redaction:** `k8s_get_yaml` on a `Secret` with `allowK8sSecretValues` off returns a manifest with `data`/`stringData` removed; with it on, returns verbatim. (Mock `readResourceYaml` to return a Secret manifest.)
- **Registry:** `buildTools` returns the expected tool names for `mongo`/`redis`/`kafka`/`kubernetes` under default policy (read-only subset).
- Driver `getPodLogs` / `deleteResource` real behavior is covered by the integration/mock-cluster harness per repo convention; not unit-tested live.

## Open items

- None blocking. (Streaming AI tools — Kafka tail, Redis pub/sub, K8s log follow —
  and blob-storage tools remain future work.)
