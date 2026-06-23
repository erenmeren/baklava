# Contributing to Baklava

Thanks for your interest in hacking on Baklava. This guide covers the stack, the project layout, how each workspace is built, and how to add a new technology. For the full conventions reference (server pages, SSE patterns, driver lifecycle, Base UI notes), see [`AGENTS.md`](AGENTS.md).

## Run it from source

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # eslint
npx vitest run   # tests
```

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (Base UI primitives, not classic Radix) + Lucide icons + Sonner toasts
- **CodeMirror** (`@uiw/react-codemirror` + `@codemirror/lang-sql`) for SQL editors; **xterm.js** for the Docker terminal
- Drivers: `dockerode`, `kafkajs`, `pg`, `mysql2`, `mssql`, `mongodb`, `ioredis`, `@kubernetes/client-node`, and `@aws-sdk/client-s3` (+ `s3-request-presigner` / `lib-storage`) for the S3-compatible stores. Drivers are optional dependencies, lazy-imported so a missing one only affects that one technology.

There is **no database**. Connections live in an in-memory store on `globalThis` and are mirrored to `~/.baklava/connections.json` (override with `BAKLAVA_DATA_DIR`) so they survive restarts.

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
    sql/                                  # format, completions, themes, dialect keywords
    auth/                                 # single-password gate (store + session)
    connections/
      store.ts                            # in-memory store on globalThis, persisted to disk
      server.ts                           # requireConnection() for server pages
      docker.ts · kafka.ts · postgres.ts · …  # per-tech driver helpers
  techs/
    <tech>/meta.ts                        # client-safe metadata (catalog, config schema)
    <tech>/index.ts                       # server module (meta + driver)
    registry.ts · meta-registry.ts        # the two registries
```

## Adding a new technology

A technology is a self-contained module under `src/techs/<tech>/`, collected by two registries. Catalog, summaries, `FIRST_PAGE`, secret keys, and health probes all derive from the registry — so adding a tech is create-module + register, not a per-file diff.

1. Add a `TechId` literal and a config interface in `src/lib/connections/types.ts` (the hand-maintained source of truth).
2. Create `src/techs/<tech>/meta.ts` — client-safe metadata (catalog entry, zod config schema, secret keys, `firstPage`). No driver import.
3. Create `src/techs/<tech>/index.ts` — spreads meta + adds `driver`. Put the driver helper in `src/lib/connections/<tech>.ts` and **lazy-import** its npm package so the dependency stays optional.
4. Register in both `src/techs/registry.ts` (full module) and `src/techs/meta-registry.ts` (meta) — one line each.
5. Add the npm driver to `optionalDependencies` in `package.json`. `serverExternalPackages` is generated from each module's `serverPackages` by `scripts/gen-server-packages.ts` (runs on `predev`/`prebuild`) — **don't** hand-edit `next.config.ts`.
6. Add API routes under `src/app/api/<tech>/` (`test`, `[id]/...`). Wrap thrown errors with `formatError`.
7. Build the form at `src/app/<tech>/<tech>-form.tsx` (reused by `ConnectionSheet`) and the workspace at `src/app/<tech>/[connectionId]/` (`layout.tsx` with `WorkspaceShell` + sidebar, one page per object kind).

Drop the brand icon at `public/icons/<tech>.svg` (a single-color `fill="#brand"` SVG in the [simple-icons](https://simpleicons.org) style; it renders in brand color on light backgrounds and a clean white silhouette in dark mode).

## What each workspace does

### Docker (Portainer-grade)

Sidebar: Containers · Images · Volumes · Networks · Stacks · Registries · Events · System.

- **Containers** — live-refreshing table (name, image, state, ports, age) with per-row Start / Stop / Restart / Remove, plus a **Create container** form (image picker, ports, env, volumes, restart policy, auto-start). Click into a container for 10 tabs:
  - **Overview**, **Logs** (auto-tails 400 lines), **Stats** (CPU / memory / network & block I/O / PIDs, refreshing every 3s)
  - **Terminal** — a true bidirectional xterm.js shell (SSE out, POST in, resize support)
  - **Exec** — one-shot run-a-command form for quick checks
  - **Files** — file browser with breadcrumbs and click-to-preview (busybox-compatible)
  - **Networks** — per-network IP / gateway / MAC / aliases, with connect & disconnect
  - **Environment**, **Mounts**, and the full **Inspect** JSON
- **Images** — list with repo:tag, ID, size, age. **Search Docker Hub** (official-image badges, pull & star counts, tag browsing), **pull any tag** with layer-by-layer SSE progress, and **build from a Dockerfile** with streaming `docker build` output. Plus pull-by-ref and force-remove.
- **Volumes** — list, create, remove.
- **Networks** — list, **create** (bridge / overlay / macvlan / ipvlan, optional subnet, internal flag), remove (built-ins protected).
- **Stacks** — paste a `docker-compose.yml`, **validate** to preview the deployment plan, then **deploy** with live SSE progress. Stack pages link into individual containers and offer stack-level actions. Everything is labelled `baklava.stack.name` so teardown stays clean. Private registry creds are auto-attached during deploy.
- **Registries** — per-connection credential store (Docker Hub / GHCR / Quay / ECR, one-click presets). Creds never touch disk.
- **Events** — live `docker events` over SSE, with type-coded badges, a filter, and pause/resume.
- **System** — KPI dashboard, full daemon detail, and **Reclaim disk** prune cards.

### PostgreSQL (pgAdmin-style)

Tree sidebar: connection → databases → schemas → tables / views / functions / sequences.

- **Overview dashboard** — signal-driven KPI strip (connections, blockers, idle-in-txn, TPS sparkline + rollback ratio, cache hit, total size), a health-badge row that appears only when something trips a threshold, and a two-column body: top slow queries (`pg_stat_statements`), blocker chains, active sessions with KILL/cancel, bloat hotspots, databases, and top tables.
- **Table tabs** — Data (paginated with total count), Structure, Indexes, Constraints (PK / FK / UNIQUE / CHECK / EXCLUDE), Foreign keys (with on-update / on-delete actions).
- **SQL editor** per database — Cmd/Ctrl+Enter to run, schema-aware autocomplete, dialect-specific keywords, and recent-query history.

### Kafka (kafka-ui-style)

Sidebar: Overview · Topics · Consumer groups · Brokers.

- **Overview** — mission-control dashboard: broker pulse, big stats (topics / partitions / messages / groups), under-replicated call-outs, top-volume leaderboard. Auto-refreshes.
- **Topics** — dense list with message-count bars, partition-skew sparklines, and ISR health. Click in for Partitions, Messages (text filter + live tail + detail drawer with pretty JSON & headers), Produce, and Configs. Schema Registry aware (Avro / JSON Schema / Protobuf).
- **Consumer groups** — lag column with severity bar, member count, topics assigned, and consumption + ETA-to-drain. Click in for member detail, per-partition offset/lag, a partition heatmap, and reset-offsets.
- **Brokers** — list with controller badge.

### SQL Server (SSMS-style)

Tree sidebar: connection → databases → schemas → all 9 SSMS object categories (tables / views / procedures / functions / sequences / user-defined types / table types / synonyms / triggers), each with a `+` to create.

- **Overview dashboard** — mirrors the Postgres layout: tone-coded KPI tiles, a conditional Signals row, and a two-column body (top queries from the plan cache, blocked sessions, active sessions with KILL, databases, top wait classes).
- **Create dialogs** on every schema group — structured forms plus a CodeMirror T-SQL editor with per-kind scaffolds.
- **Tables** — Data / Structure / Indexes / Foreign keys / Triggers.
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

Sidebar lists collections. Click into a collection for **Points** (browse with pagination, show/hide raw vectors), **Search** (similarity search with ranked hits), and **Config** (vector params).

### Object storage — Cloudflare R2 · MinIO · Amazon S3

All three are S3-compatible and share **one object-storage workspace** (a file manager) built on a single shared S3 core, so each backend is just a small connection adapter.

- **Connect** — each form **Tests** by listing buckets before saving; secrets are redacted and never returned over the API.
- **Buckets** — sidebar list with create / delete.
- **File manager** (per bucket) — breadcrumb navigation, object table, **upload** (streaming multipart), **download** (presigned), **copy presigned link**, **copy / rename / move**, multi-select **bulk delete**, **new folder**, and an **object detail drawer**.
- **Settings** (per bucket) — **CORS** and **lifecycle** editors (R2 + S3), plus a read-only **public-access** panel.
