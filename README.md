# Baklava

Open-source unified ops console — modeled on the dedicated tools you already know (Docker Desktop, pgAdmin, kafka-ui, SSMS, RedisInsight, Compass, k9s, an S3 browser) so you can stop juggling tabs.

Integrated technologies, by category:

- **Runtime** — Docker
- **Database** — PostgreSQL · MySQL · SQL Server · MongoDB
- **Streaming** — Kafka
- **Orchestration** — Kubernetes
- **Cache** — Redis
- **Storage** — Cloudflare R2 · MinIO · Amazon S3 (S3-compatible object storage)

A global **⌘K command palette** jumps you to any connection, section, or object from anywhere.

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

Tree sidebar: connection → databases → schemas → tables / views / functions / sequences.

- **Overview dashboard**: signal-driven KPI strip (connections with bar, blockers, idle-in-txn, TPS sparkline + rollback ratio, cache hit, total size), conditional health-badge row when anything trips a threshold, two-column body — Top slow queries (`pg_stat_statements`), blocker chains, active sessions with KILL/cancel, bloat hotspots, databases panel, top tables.
- Click any table for tabs: **Data** (paginated 100/page with total count), **Structure** (columns, types, nullability, defaults, PK badges), **Indexes** (with definitions), **Constraints** (PK / FK / UNIQUE / CHECK / EXCLUDE), **Foreign keys** (with on-update / on-delete actions).
- Each database has its own **SQL editor** (Cmd/Ctrl+Enter to run, results capped at 500 rows, schema-aware autocomplete, dialect-specific keywords, history of recent queries).

### Kafka (kafka-ui-style)

Sidebar: Overview · Topics · Consumer groups · Brokers.

- **Overview** (mission-control dashboard): broker pulse strip, big stats (topics / partitions / messages / consumer groups), under-replicated-topic call-outs, top-volume leaderboard. Auto-refreshes every 15s.
- **Topics**: dense list with message-count bars, partition-skew sparklines, ISR health pill. Click into a topic for tabs: Partitions, Messages (with key/value text filter + live tail + click-row-for-detail-drawer with JSON-pretty value + headers table), Produce, Configs. Schema Registry support (Avro / JSON Schema / Protobuf — sniffs the Confluent magic byte on consume).
- **Consumer groups**: lag column with severity bar (green/amber/red), member count, topics-assigned, **consumption + ETA-to-drain** columns. Click into one for member detail, per-partition offset/lag, partition heatmap, and reset-offsets (with pre-flight state check).
- **Brokers**: list with controller badge.

### SQL Server (SSMS-style)

Tree sidebar: connection → databases → schemas → tables / views / procedures / functions / sequences / user-defined types / table types / synonyms / triggers (all 9 SSMS-style categories, with `+` to create on every group).

- **Overview dashboard**: matches the Postgres layout — 6 tone-coded KPI tiles (connections w/ bar, blockers, idle-in-txn, longest query, buffer cache hit, total size across all DBs), conditional Signals row only when something trips a threshold (red/amber). Two-column body: top queries from the plan cache, blocked sessions, active sessions with KILL, databases panel, top wait classes from `sys.dm_os_wait_stats` (with the Paul-Randal benign-waits filter). Refresh control: select dropdown (Off / 5s / 15s / 30s / 1m / 5m), defaults to **Off** so an idle tab doesn't generate traffic.
- **Create dialogs** on every schema group: structured forms for Tables / Sequences / Synonyms / User-Defined Types / Table Types, plus a CodeMirror-backed T-SQL editor with per-kind scaffolds for Views / Procedures / Functions / Triggers (SSMS "Script CREATE To" pattern). Identifier whitelist + `;`-in-fragment guard on all server-built SQL.
- **Tables**: tabs for Data / Structure / Indexes / Foreign keys / Triggers. Drop dialog with FORCE (single-user + rollback immediate) for databases.
- **Activity / Locks / Top queries / Query Store / Index maintenance / Security / Backup** as dedicated server-level pages off the sidebar.
- Each database has its own **SQL editor** with MSSQL dialect, curated keywords + types, schema-aware autocomplete, `GO` batch splits, and `STATISTICS IO/TIME` toggle.

### MySQL (phpMyAdmin-style)

Databases → tables, a CodeMirror SQL editor, row-level CRUD, indexes, and a live process list with KILL.

### MongoDB (Compass-style)

Databases → collections, a document browser with EJSON filtering, an aggregation-pipeline runner, indexes, and server / replica-set / current-op pages.

### Kubernetes (k9s-style)

Terminal-style browser for pods, deployments, services, configmaps, secrets and namespaces, with a `:`-triggered command runner, pod logs, exec, and an in-browser shell.

### Redis (RedisInsight-style)

Typed key viewer, CLI, pub/sub, streams, `MONITOR`, cluster topology, ACL, and server info — single-node or cluster.

### Object storage — Cloudflare R2 · MinIO · Amazon S3 (S3-compatible)

All three are S3-compatible and share **one object-storage workspace** (a file manager), built on a single shared S3 core so each backend is just a small connection adapter.

- **Connect**: R2 (account ID + access key ID + secret), MinIO (endpoint as `host:port` or full URL + a Use-SSL toggle + access/secret + region), Amazon S3 (region + access key ID + secret + optional session token for temporary STS credentials). Each form **Tests** by listing buckets before saving; secrets are stored redacted and never returned over the API.
- **Buckets**: sidebar lists buckets with create / delete.
- **File manager** (per bucket): breadcrumb prefix/folder navigation, object table (name · size · last-modified · storage class), **upload** (file picker, streaming multipart), **download** (presigned redirect), **copy presigned link**, **copy / rename / move**, multi-select **bulk delete**, **new folder**, and an **object detail drawer** (size, content-type, ETag, custom metadata, HTTP headers).
- **Settings** (per bucket): **CORS** and **lifecycle** rule editors (R2 + S3; MinIO shows a note because it doesn't implement the per-bucket CORS API and configures CORS at the server level). A read-only **public-access** panel links out to the provider's dashboard (Cloudflare for R2, the AWS console for S3).

## Command palette

Press **⌘K / Ctrl+K** (or the **⌘K** pill in the header) from anywhere to:

- jump to any saved connection's workspace (recent-first),
- jump to a section of the connection you're currently in (Tables, Topics, Buckets, Pods, …),
- search objects in the active connection (tables on PostgreSQL / MySQL / SQL Server),
- run quick actions (new connection, go home, toggle theme).

(Kubernetes keeps its own `:`-triggered k9s-style command runner alongside the global palette.)

## Stack

- Next.js 16 (App Router) + React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui (Base UI primitives) + Lucide icons + Sonner toasts
- CodeMirror (`@uiw/react-codemirror` + `@codemirror/lang-sql`) for SQL editors; xterm.js for the Docker terminal
- Drivers: `dockerode`, `kafkajs`, `pg`, `mysql2`, `mssql`, `mongodb`, `ioredis`, `@kubernetes/client-node`, and `@aws-sdk/client-s3` (+ `s3-request-presigner` / `lib-storage`) for the S3-compatible object stores

## Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Docker is reachable out of the box at `unix:///var/run/docker.sock` on macOS / Linux.

### Test stack

A `compose.yaml` at the project root spins up local instances of Postgres, Kafka, and SQL Server:

```bash
docker compose up -d           # everything
docker compose up -d postgres  # just one service
docker compose down -v         # stop + wipe data
```

Then populate demo data so the workspaces have something to browse:

```bash
bash seed/all.sh               # docker stack + pg/kafka/sqlserver data
bash seed/postgres.sh          # just one tech
```

See [`seed/README.md`](seed/README.md) for what each script creates (one of every SSMS-style object in SQL Server, a keyed message stream in Kafka, a labelled three-container demo stack in Docker, a 250-row storefront schema in Postgres).

#### Connection details

All credentials are throwaway and for local dev only. Plug these into the connection forms in the UI.

| Tech | Host | Port | User | Password | Notes |
|---|---|---:|---|---|---|
| **Docker** | — | — | — | — | uses `unix:///var/run/docker.sock` automatically |
| **PostgreSQL** | localhost | 5432 | `postgres` | `Baklava123!` | database `demo` |
| **Kafka** | — | — | — | — | broker `localhost:9092` |
| **SQL Server** | localhost | 1433 | `sa` | `Baklava123!` | encrypt: on, trustServerCertificate: on |

SQL Server runs under `linux/amd64` (Rosetta on Apple Silicon) — startup is ~30s and uses ~2GB RAM.

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
        stacks/page.tsx
    postgres/
      page.tsx
      [connectionId]/
        layout.tsx                        # tree sidebar (db > schema > table)
        overview-client.tsx               # signal-driven dashboard
        databases/[db]/
          query/page.tsx                  # SQL editor
          schemas/[schema]/tables/[table]/page.tsx
    kafka/
      page.tsx
      [connectionId]/
        layout.tsx
        topics/page.tsx
        topics/[topic]/page.tsx           # tabs: partitions/messages/produce/configs
        consumer-groups/page.tsx
        consumer-groups/[group]/page.tsx
        brokers/page.tsx
    sqlserver/
      page.tsx
      [connectionId]/
        layout.tsx                        # tree sidebar (db > schema > 9 group kinds)
        overview-client.tsx               # signal-driven dashboard
        create-*-dialog.tsx               # 9 create dialogs
        databases/[db]/
          query/[queryId]/page.tsx        # T-SQL editor (CodeMirror + MSSQL)
          tables/[schema]/[name]/page.tsx
    api/                                  # all server routes
  components/
    workspace/                            # shared workspace shell, sidebar links, page chrome
    sql/                                  # shared SQL editor toolkit (Postgres + SQL Server)
    ui/                                   # shadcn components
  lib/
    tech-catalog.ts                       # registry of integrated technologies
    sql/                                  # format, completions, themes, dialect keywords
    connections/
      types.ts
      store.ts                            # in-memory store on globalThis, persisted to disk
      server.ts                           # requireConnection() for server pages
      docker.ts                           # dockerode helpers
      kafka.ts                            # kafkajs helpers
      postgres.ts                         # pg helpers
      sqlserver.ts                        # mssql helpers
```

## Adding another technology

1. Add an entry to `src/lib/tech-catalog.ts` and a corresponding `TechId` + config interface in `src/lib/connections/types.ts`.
2. Drop a driver helper in `src/lib/connections/<tech>.ts` (probe + per-object operations).
3. If the driver is a native package, add it to `serverExternalPackages` in `next.config.ts`.
4. Add API routes under `src/app/api/<tech>/`.
5. Add the connection form at `src/app/<tech>/<tech>-form.tsx` (reused by `ConnectionSheet`; connection management lives in the home-screen sheet, not a standalone `/<tech>` page).
6. Add a workspace at `src/app/<tech>/[connectionId]/` with a `layout.tsx` (uses `WorkspaceShell` + your sidebar) and one page per object kind.
7. Add the tech to `FIRST_PAGE` in `src/components/connection-tabs.tsx` and the `FORMS` map in `src/components/connection-sheet.tsx`.

See [`AGENTS.md`](AGENTS.md) for the full conventions guide (server pages, SSE patterns, driver lifecycle, base-ui notes).

## License

Open source — license to be added.
