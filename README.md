# Baklava

**One console for your whole backend.** Baklava is an open-source ops dashboard for the tools you already run — Docker, Postgres, Kafka, Kubernetes, and more — each modeled on the dedicated app you'd otherwise reach for (Docker Desktop, pgAdmin, kafka-ui, SSMS, RedisInsight, Compass, k9s, an S3 browser). Stop juggling a dozen tabs and native apps; manage everything from one place.

```bash
npm install
npm run dev
# → http://localhost:3000
```

That's it. Docker works out of the box; for everything else you add a connection in the UI.

---

## What's integrated

| Category | Technologies |
|---|---|
| **Runtime** | Docker |
| **Database** | PostgreSQL · MySQL · SQL Server · MongoDB |
| **Streaming** | Kafka |
| **Orchestration** | Kubernetes |
| **Cache** | Redis |
| **Vector** | Qdrant |
| **Object storage** | Cloudflare R2 · MinIO · Amazon S3 |

A global **⌘K command palette** jumps you to any connection, section, or object from anywhere.

## How it works

1. **Pick a technology** from the home grid.
2. **Configure and test** a connection. A successful test saves it.
3. **Open** a saved connection to land in a full **workspace** — sidebar, tables, detail views — shaped like the dedicated tool for that tech.

Connections persist to `~/.baklava/connections.json` (chmod `600`) so they survive restarts. Override the location with `BAKLAVA_DATA_DIR`. Passwords are stored in plaintext — the same posture as `~/.kube/config`, `~/.docker/config.json`, or `~/.aws/credentials`.

## Security & the default password

Baklava can read every stored credential and run destructive queries, so when the server is reachable from a network it sits behind a **single shared password gate** (one password, no usernames).

- **First run seeds the password to `password123`** and flags it for change. The very first sign-in **forces you to set a new one** before you can do anything.
- **Set your own from the start** with the `BAKLAVA_INITIAL_PASSWORD` environment variable. A password you chose is trusted, so the forced-change step is skipped:

  ```bash
  BAKLAVA_INITIAL_PASSWORD='choose-something-strong' npm run dev
  ```

- **Change it later** in **Settings → Security**, and **Lock console** (in the header) signs you out.
- **Turn the gate off** in **Settings → Security** — handy on a trusted localhost machine where the login prompt is just friction. Leave it **on** for anything exposed to a network.

The password is scrypt-hashed and stored in `~/.baklava/auth.json` (chmod `600`, next to your connections). It never leaves the server.

---

## Workspaces

### Docker (Portainer-grade)

Sidebar: Containers · Images · Volumes · Networks · Stacks · Registries · Events · System.

- **Containers** — live-refreshing table (name, image, state, ports, age) with per-row Start / Stop / Restart / Remove, plus a **Create container** form (image picker, ports, env, volumes, restart policy, auto-start). Click into a container for 10 tabs:
  - **Overview**, **Logs** (auto-tails 400 lines), **Stats** (CPU / memory / network & block I/O / PIDs, refreshing every 3s)
  - **Terminal** — a true bidirectional xterm.js shell (SSE out, POST in, resize support)
  - **Exec** — one-shot run-a-command form for quick checks
  - **Files** — file browser with breadcrumbs and click-to-preview (busybox-compatible)
  - **Networks** — per-network IP / gateway / MAC / aliases, with connect & disconnect
  - **Environment**, **Mounts**, and the full **Inspect** JSON
- **Images** — list with repo:tag, ID, size, age. **Search Docker Hub** (official-image badges, pull & star counts, tag browsing), **pull any tag** with layer-by-layer SSE progress, and **build from a Dockerfile** with streaming `docker build` output (no local context needed). Plus pull-by-ref and force-remove.
- **Volumes** — list, create, remove.
- **Networks** — list, **create** (bridge / overlay / macvlan / ipvlan, optional subnet, internal flag), remove (built-ins protected).
- **Stacks** — paste a `docker-compose.yml`, **validate** to preview the deployment plan (services, networks, volumes, ports, dependency order), then **deploy** with live SSE progress. Stack pages link into individual containers and offer stack-level Start / Stop / Restart / Remove. Everything is labelled `baklava.stack.name` so teardown stays clean. Private registry creds are auto-attached during deploy.
- **Registries** — per-connection credential store (Docker Hub / GHCR / Quay / ECR, one-click presets). Baklava attaches the right creds to each pull by image host. Creds never touch disk.
- **Events** — live `docker events` over SSE, with type-coded badges, a filter, and pause/resume.
- **System** — KPI dashboard (running/stopped containers, image count, CPUs, memory, versions), full daemon detail, and **Reclaim disk** prune cards (containers / images / volumes / networks / build cache).

### PostgreSQL (pgAdmin-style)

Tree sidebar: connection → databases → schemas → tables / views / functions / sequences.

- **Overview dashboard** — signal-driven KPI strip (connections, blockers, idle-in-txn, TPS sparkline + rollback ratio, cache hit, total size), a health-badge row that appears only when something trips a threshold, and a two-column body: top slow queries (`pg_stat_statements`), blocker chains, active sessions with KILL/cancel, bloat hotspots, databases, and top tables.
- **Table tabs** — Data (paginated, 100/page with total count), Structure, Indexes, Constraints (PK / FK / UNIQUE / CHECK / EXCLUDE), Foreign keys (with on-update / on-delete actions).
- **SQL editor** per database — Cmd/Ctrl+Enter to run, results capped at 500 rows, schema-aware autocomplete, dialect-specific keywords, and recent-query history.

### Kafka (kafka-ui-style)

Sidebar: Overview · Topics · Consumer groups · Brokers.

- **Overview** — mission-control dashboard: broker pulse, big stats (topics / partitions / messages / groups), under-replicated call-outs, top-volume leaderboard. Auto-refreshes every 15s.
- **Topics** — dense list with message-count bars, partition-skew sparklines, and ISR health. Click in for Partitions, Messages (text filter + live tail + detail drawer with pretty JSON & headers), Produce, and Configs. Schema Registry aware (Avro / JSON Schema / Protobuf via the Confluent magic byte).
- **Consumer groups** — lag column with severity bar, member count, topics assigned, and consumption + ETA-to-drain. Click in for member detail, per-partition offset/lag, a partition heatmap, and reset-offsets.
- **Brokers** — list with controller badge.

### SQL Server (SSMS-style)

Tree sidebar: connection → databases → schemas → all 9 SSMS object categories (tables / views / procedures / functions / sequences / user-defined types / table types / synonyms / triggers), each with a `+` to create.

- **Overview dashboard** — mirrors the Postgres layout: 6 tone-coded KPI tiles, a conditional Signals row, and a two-column body (top queries from the plan cache, blocked sessions, active sessions with KILL, databases, top wait classes with the benign-waits filter). Refresh defaults to **Off** so an idle tab is quiet.
- **Create dialogs** on every schema group — structured forms for Tables / Sequences / Synonyms / UDTs / Table Types, plus a CodeMirror T-SQL editor with per-kind scaffolds for Views / Procedures / Functions / Triggers.
- **Tables** — Data / Structure / Indexes / Foreign keys / Triggers, with a FORCE drop dialog for databases.
- Dedicated server-level pages: **Activity / Locks / Top queries / Query Store / Index maintenance / Security / Backup**.
- **SQL editor** per database — MSSQL dialect, curated keywords & types, schema-aware autocomplete, `GO` batch splits, and a `STATISTICS IO/TIME` toggle.

### MySQL (phpMyAdmin-style)

Databases → tables, a CodeMirror SQL editor, row-level CRUD, indexes, and a live process list with KILL.

### MongoDB (Compass-style)

Databases → collections, a document browser with EJSON filtering, an aggregation-pipeline runner, indexes, and server / replica-set / current-op pages.

### Kubernetes (k9s-style)

Terminal-style browser for pods, deployments, services, configmaps, secrets, and namespaces — with a `:`-triggered command runner, pod logs, exec, and an in-browser shell.

### Redis (RedisInsight-style)

Typed key viewer, CLI, pub/sub, streams, `MONITOR`, cluster topology, ACL, and server info — single-node or cluster.

### Qdrant (vector database)

Sidebar lists collections. Click into a collection for three tabs:

- **Points** — browse points with pagination, toggle to show/hide raw vectors.
- **Search** — run similarity search and inspect the ranked hits.
- **Config** — the collection's vector params and configuration.

### Object storage — Cloudflare R2 · MinIO · Amazon S3

All three are S3-compatible and share **one object-storage workspace** (a file manager) built on a single shared S3 core, so each backend is just a small connection adapter.

- **Connect** — R2 (account ID + access key + secret), MinIO (`host:port` or full URL + Use-SSL toggle + access/secret + region), Amazon S3 (region + access key + secret + optional STS session token). Each form **Tests** by listing buckets before saving; secrets are redacted and never returned over the API.
- **Buckets** — sidebar list with create / delete.
- **File manager** (per bucket) — breadcrumb navigation, object table (name · size · last-modified · storage class), **upload** (streaming multipart), **download** (presigned), **copy presigned link**, **copy / rename / move**, multi-select **bulk delete**, **new folder**, and an **object detail drawer** (size, content-type, ETag, metadata, headers).
- **Settings** (per bucket) — **CORS** and **lifecycle** editors (R2 + S3; MinIO notes that CORS is configured server-side), plus a read-only **public-access** panel linking to the provider's dashboard.

## Command palette

Press **⌘K / Ctrl+K** (or the **⌘K** pill in the header) from anywhere to:

- jump to any saved connection's workspace (recent-first),
- jump to a section of the connection you're in (Tables, Topics, Buckets, Pods, …),
- search objects in the active connection (tables on PostgreSQL / MySQL / SQL Server),
- run quick actions (new connection, go home, toggle theme).

Kubernetes keeps its own `:`-triggered k9s-style command runner alongside the global palette.

---

## Try it out

### Local test stack

A `compose.yaml` at the project root spins up Postgres, Kafka, and SQL Server:

```bash
docker compose up -d           # everything
docker compose up -d postgres  # just one service
docker compose down -v         # stop + wipe data
```

Then seed demo data so the workspaces have something to browse:

```bash
bash seed/all.sh               # docker stack + pg/kafka/sqlserver data
bash seed/postgres.sh          # just one tech
```

See [`seed/README.md`](seed/README.md) for what each script creates (one of every SSMS object in SQL Server, a keyed Kafka stream, a labelled three-container Docker stack, and a 250-row storefront schema in Postgres).

**Connection details** — all throwaway, local-dev only. Plug them into the connection forms:

| Tech | Host | Port | User | Password | Notes |
|---|---|---:|---|---|---|
| **Docker** | — | — | — | — | uses `unix:///var/run/docker.sock` automatically |
| **PostgreSQL** | localhost | 5432 | `postgres` | `Baklava123!` | database `demo` |
| **Kafka** | — | — | — | — | broker `localhost:9092` |
| **SQL Server** | localhost | 1433 | `sa` | `Baklava123!` | encrypt: on, trustServerCertificate: on |

> SQL Server runs under `linux/amd64` (Rosetta on Apple Silicon) — startup is ~30s and uses ~2GB RAM.

### Spin up other services

To point Baklava at services outside the compose stack:

| Tech | Command |
|---|---|
| **PostgreSQL** | `docker run -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:latest` |
| **MySQL** | `docker run -p 3306:3306 -e MYSQL_ROOT_PASSWORD=password mysql:latest` |
| **MongoDB** | `docker run -p 27017:27017 mongo:latest` |
| **Kafka** | `docker run -p 9092:9092 -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092 -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT confluentinc/cp-kafka:latest` |
| **Redis** | `docker run -p 6379:6379 redis:latest` |
| **Qdrant** | `docker run -p 6333:6333 qdrant/qdrant` |
| **MinIO** | `docker run -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio:latest server /minio --console-address ":9001"` |

For Kubernetes, point Baklava at your `~/.kube/config` — no local setup needed.

---

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (Base UI primitives) + Lucide icons + Sonner toasts
- **CodeMirror** (`@uiw/react-codemirror` + `@codemirror/lang-sql`) for SQL editors; **xterm.js** for the Docker terminal
- Drivers: `dockerode`, `kafkajs`, `pg`, `mysql2`, `mssql`, `mongodb`, `ioredis`, `@kubernetes/client-node`, and `@aws-sdk/client-s3` (+ `s3-request-presigner` / `lib-storage`) for the S3-compatible stores

## Project layout

```
src/
  app/
    page.tsx                              # home grid
    docker/[connectionId]/               # workspace shell + sidebar, one page per object
    postgres/[connectionId]/             # tree sidebar (db > schema > table) + SQL editor
    kafka/[connectionId]/                # topics / consumer-groups / brokers
    sqlserver/[connectionId]/            # tree sidebar (db > schema > 9 group kinds)
    api/                                  # all server routes
  components/
    workspace/                            # shared workspace shell, sidebar, page chrome
    sql/                                  # shared SQL editor toolkit
    ui/                                   # shadcn components
  lib/
    tech-catalog.ts                       # registry of integrated technologies
    sql/                                  # format, completions, themes, dialect keywords
    auth/                                 # single-password gate (store + session)
    connections/
      store.ts                            # in-memory store on globalThis, persisted to disk
      server.ts                           # requireConnection() for server pages
      docker.ts · kafka.ts · postgres.ts · sqlserver.ts · …  # per-tech driver helpers
```

## Adding another technology

A technology is a self-contained module under `src/techs/<tech>/`, collected by two registries. Catalog, summaries, `FIRST_PAGE`, secret keys, and health probes all derive from the registry — so adding a tech is create-module + register, not a per-file diff.

1. Add a `TechId` literal and a config interface in `src/lib/connections/types.ts` (the hand-maintained source of truth).
2. Create `src/techs/<tech>/meta.ts` — client-safe metadata (catalog entry, zod config schema, secret keys, `firstPage`). No driver import.
3. Create `src/techs/<tech>/index.ts` — spreads meta + adds `driver`. Put the driver helper in `src/lib/connections/<tech>.ts` and **lazy-import** its npm package so the dependency stays optional.
4. Register in both `src/techs/registry.ts` (full module) and `src/techs/meta-registry.ts` (meta) — one line each.
5. Add the npm driver to `optionalDependencies` in `package.json`. `serverExternalPackages` is generated from each module's `serverPackages` by `scripts/gen-server-packages.ts` (runs on `predev`/`prebuild`) — **don't** hand-edit `next.config.ts`.
6. Add API routes under `src/app/api/<tech>/` (`test`, `[id]/...`). Wrap thrown errors with `formatError`.
7. Build the form at `src/app/<tech>/<tech>-form.tsx` (reused by `ConnectionSheet`) and the workspace at `src/app/<tech>/[connectionId]/` (`layout.tsx` with `WorkspaceShell` + sidebar, one page per object kind).

See [`AGENTS.md`](AGENTS.md) for the full conventions guide (server pages, SSE patterns, driver lifecycle, Base UI notes).

## License

Open source — license to be added.
