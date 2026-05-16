# Baklava

Open-source unified ops console. One UI for Docker, Kafka, PostgreSQL, MySQL, SQL Server, MongoDB, Redis, RabbitMQ, NATS, Elasticsearch, ClickHouse, SQLite, and etcd — modeled on the dedicated tools you already know (Docker Desktop, kafka-ui, pgAdmin) so you can stop juggling tabs.

## What it does

- A grid of integrated technologies on the home screen.
- Click in to configure and test a connection. A successful test stores it in memory.
- "Open" a saved connection and you land in a full **workspace** with a sidebar and per-object detail views — same shape as the dedicated tool for that tech.
- Connections persist to `~/.baklava/connections.json` (chmod 600) so they survive Next.js restarts. Override the location with `BAKLAVA_DATA_DIR`. Passwords are stored in plaintext — same posture as `~/.kube/config`, `~/.docker/config.json`, `~/.aws/credentials`.

## Workspaces

### Docker (Portainer-grade)

Sidebar: Containers · Images · Volumes · Networks · Stacks · Registries · Events · System.

- **Containers**: live-refreshing table with name, image, state, ports, age. Per-row Start / Stop / Restart / Remove. **Create container** form (image picker, name, ports, env, volumes, restart policy, auto-start). Click into a container for 10 tabs: Overview, Logs (auto-tailing 400 lines), **Stats** (CPU / memory / network I/O / block I/O / PIDs, refreshing every 3s), **Terminal** (true bidirectional xterm.js shell — SSE for output, POST for input, resize support, honey-cursor theme), **Exec** (one-shot run-command form for quick checks), **Files** (file browser with breadcrumb nav, busybox-compatible directory listing, click files to preview), **Networks** (per-network IP / gateway / MAC / aliases with disconnect + connect-to-another-network), Environment, Mounts, full Inspect JSON. Header actions: Restart / Pause / Stop / Remove.
- **Images**: list with repo:tag, ID, size, age. **Search Docker Hub** — official-image badges, pull counts, star counts; click a result to browse tags. Pull any tag with **layer-by-layer SSE progress**. **Build from Dockerfile** — paste a Dockerfile + tag, build streams `docker build` output as it runs (no local context required). Plus pull-by-ref for arbitrary registries, and force-remove.
- **Volumes**: list with driver / mountpoint, create new, remove.
- **Networks**: list with driver / scope, **create** (bridge / overlay / macvlan / ipvlan, optional subnet, internal flag), remove (built-in networks protected).
- **Stacks**: paste a `docker-compose.yml`, validate to preview the deployment plan (services, networks, volumes, port mappings, dependency order), then deploy with live SSE progress (per-phase log + per-service status pills). Stack detail page lists all services with links into individual containers, plus stack-level Start / Stop / Restart / Remove (with optional volume cleanup). Containers / networks / volumes are labelled with `baklava.stack.name` so listing and teardown filter cleanly. Auto-attaches your private registry creds to image pulls during deploy.
- **Registries**: per-connection in-memory credential store. Add Docker Hub / GHCR / Quay / ECR creds (one-click presets), and Baklava auto-attaches the right credential to any pull based on the image's host. Creds never touch disk.
- **Events**: live `docker events` stream over SSE — type-coded badges (container / image / network / volume), filter input, pause/resume, clear.
- **System**: KPI dashboard (containers running/stopped, image count, CPUs, memory, server / API versions), full daemon detail (hostname, OS, kernel, architecture, storage driver, root dir), **Reclaim disk** with prune cards for containers / images / volumes / networks / build cache.

### PostgreSQL (pgAdmin-style)

Tree sidebar: connection → databases → schemas → tables / views.

- Click any table for tabs: **Data** (paginated 100/page with total count), **Structure** (columns, types, nullability, defaults, PK badges), **Indexes** (with definitions), **Constraints** (PK / FK / UNIQUE / CHECK / EXCLUDE), **Foreign keys** (with on-update / on-delete actions).
- Each database has its own **SQL editor** (Cmd/Ctrl+Enter to run, results capped at 500 rows, history of recent queries).

### Kafka (kafka-ui-style)

Sidebar: Overview · Topics · Consumer groups · Brokers.

- **Overview** (mission-control dashboard): broker pulse strip, big stats (topics / partitions / messages / consumer groups), under-replicated-topic call-outs, top-volume leaderboard. Auto-refreshes every 15s.
- **Topics**: dense list with message-count bars, partition-skew sparklines, ISR health pill. Click into a topic for tabs: Partitions, Messages (with key/value text filter + live tail + click-row-for-detail-drawer with JSON-pretty value + headers table), Produce, Configs.
- **Consumer groups**: lag column with severity bar (green/amber/red), member count, topics-assigned. Click into one for member detail, per-partition offset/lag, and reset-offsets (with pre-flight state check).
- **Brokers**: list with controller badge.

### The other ten (MVP workspaces)

Each ships a connection form, a mission-control overview (auto-refresh 15s), a primary browse list, and a per-object detail page:

| Tech | Primary browse | Detail |
|---|---|---|
| **MySQL** | databases | tables (engine, rows, size bar, collation) |
| **SQL Server** | databases | tables (`schema.name`, rows, reserved size, state pill) |
| **MongoDB** | databases | collections (type pill, docs, storage bar, indexes) |
| **SQLite** | tables | columns / data spreadsheet / DDL / indexes |
| **Redis** | keys (SCAN paginated) | type-specific value viewer (string/list/hash/set/zset/stream) + TTL + memory + delete |
| **etcd** | keys (prefix-filtered) | value + create/mod/version metadata + delete |
| **RabbitMQ** | queues (severity bar) | overview / bindings / consumers / peek messages (with requeue toggle) |
| **NATS** | streams (JetStream) | overview / subjects (live counts) / consumers / messages (walk back from `last_seq`) |
| **Elasticsearch** | indices (health pill) | overview / mappings / settings / search (Lucene `q`) / shards |
| **ClickHouse** | tables (engine pill) | columns / sample / partitions / DDL + truncate + drop |

## Stack

- Next.js 16 (App Router) + React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui (Radix / Base UI) + Lucide icons + Sonner toasts
- Drivers: `dockerode`, `kafkajs`, `pg`, `mysql2`, `mssql`, `mongodb`, `better-sqlite3`, `ioredis`, `etcd3`, `amqplib`, `nats`, `@elastic/elasticsearch`, `@clickhouse/client`

## Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Docker is reachable out of the box at `unix:///var/run/docker.sock` on macOS / Linux.

### Test stack (every supported tech)

A `compose.yaml` at the project root spins up one local instance of every tech Baklava integrates with:

```bash
docker compose up -d           # everything
docker compose up -d redis     # just one service
docker compose down -v         # stop + wipe data
```

SQLite is file-backed (no daemon). Generate a seeded demo database with:

```bash
bash seed/sqlite.sh            # writes /tmp/baklava-data/demo.sqlite
```

#### Connection details

All credentials are throwaway and for local dev only. Plug these into the connection forms in the UI.

| Tech | Host | Port | User | Password | Notes |
|---|---|---:|---|---|---|
| **Docker** | — | — | — | — | uses `unix:///var/run/docker.sock` automatically |
| **PostgreSQL** | localhost | 5432 | `postgres` | `Baklava123!` | database `demo` |
| **MySQL** | localhost | 3306 | `root` | `Baklava123!` | database `demo` |
| **SQL Server** | localhost | 1433 | `sa` | `Baklava123!` | encrypt: on, trustServerCertificate: on |
| **SQLite** | — | — | — | — | file `/tmp/baklava-data/demo.sqlite` (run `seed/sqlite.sh` first) |
| **MongoDB** | localhost | 27017 | — | — | no auth |
| **Redis** | localhost | 6379 | — | — | TLS off, db 0 |
| **etcd** | — | — | — | — | host `http://localhost:2379` |
| **Kafka** | — | — | — | — | broker `localhost:9092` |
| **RabbitMQ** | localhost | 5672 | `guest` | `guest` | vhost `/`, mgmt port `15672` |
| **NATS** | — | — | — | — | server `nats://localhost:4222` (JetStream enabled) |
| **Elasticsearch** | — | — | — | — | node `http://localhost:9200` (security off) |
| **ClickHouse** | — | — | `default` | *(blank)* | url `http://localhost:8123`, database `default` |

SQL Server runs under `linux/amd64` (Rosetta on Apple Silicon) — startup is ~30s and uses ~2GB RAM. Elasticsearch is heap-capped at 512MB.

## Project layout

```
src/
  app/
    page.tsx                              # home grid
    docker/
      page.tsx                            # connection landing
      [connectionId]/
        layout.tsx                        # workspace shell + sidebar
        containers/page.tsx
        containers/[cid]/page.tsx
        images/page.tsx
        volumes/page.tsx
        networks/page.tsx
    kafka/
      page.tsx
      [connectionId]/
        layout.tsx
        topics/page.tsx
        topics/[topic]/page.tsx           # tabs: partitions/messages/produce/configs
        consumer-groups/page.tsx
        consumer-groups/[group]/page.tsx
        brokers/page.tsx
    postgres/
      page.tsx
      [connectionId]/
        layout.tsx                        # tree sidebar (db > schema > table)
        databases/[db]/
          query/page.tsx                  # SQL editor
          schemas/[schema]/tables/[table]/page.tsx   # tabs: Data/Structure/Indexes/Constraints/FKs
    api/                                  # all server routes
  components/
    workspace/                            # shared workspace shell, sidebar links, page chrome
    ui/                                   # shadcn components
  lib/
    tech-catalog.ts                       # registry of integrated technologies
    connections/
      types.ts
      store.ts                            # in-memory store on globalThis
      server.ts                           # requireConnection() for server pages
      docker.ts                           # dockerode helpers
      kafka.ts                            # kafkajs helpers
      postgres.ts                         # pg helpers
```

## Adding another technology

1. Add an entry to `src/lib/tech-catalog.ts` and a corresponding `TechId` in `src/lib/connections/types.ts`.
2. Drop a driver helper in `src/lib/connections/<tech>.ts`.
3. Add API routes under `src/app/api/<tech>/`.
4. Add the connection landing page at `src/app/<tech>/page.tsx`.
5. Add a workspace at `src/app/<tech>/[connectionId]/` with a `layout.tsx` (uses `WorkspaceShell` + your sidebar) and one page per object kind.

## License

Open source — license to be added.
