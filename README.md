# Baklava

Open-source unified ops console. One UI for Docker, Kafka, PostgreSQL and friends — modeled on the dedicated tools you already know (Docker Desktop, kafka-ui, pgAdmin) so you can stop juggling tabs.

## What it does

- A grid of integrated technologies on the home screen.
- Click in to configure and test a connection. A successful test stores it in memory.
- "Open" a saved connection and you land in a full **workspace** with a sidebar and per-object detail views — same shape as the dedicated tool for that tech.
- Connections are **never persisted to disk**. They live in the Node process and disappear on restart.

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

Sidebar: Topics · Consumer groups · Brokers.

- **Topics**: list with partition / replica counts, internal-topic toggle, create with partitions+RF, delete with confirm. Click into a topic for tabs: **Partitions** (leader, replicas, ISR, low/high watermarks, message count), **Messages** (consume up to 100, filter by partition, from-beginning toggle), **Produce** (key + value form), **Configs** (full config table with default flags).
- **Consumer groups**: list with state badge, click into one for members + per-topic-partition offset/lag table.
- **Brokers**: list with controller badge.

## Stack

- Next.js 16 (App Router) + React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui (Radix / Base UI) + Lucide icons + Sonner toasts
- Drivers: `dockerode`, `kafkajs`, `pg`

## Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. To try the workspaces with real services:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=demo -p 5432:5432 postgres:16-alpine
docker run -d --name kafka -p 9092:9092 \
  -e KAFKA_NODE_ID=1 -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093 \
  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092 \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093 \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
  -e CLUSTER_ID=YbAkUvK2QaWdh1lUdN6Vlw \
  apache/kafka:3.8.0
```

Docker is reachable out of the box at `unix:///var/run/docker.sock` on macOS / Linux.

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
