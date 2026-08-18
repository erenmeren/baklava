# Baklava Roadmap

Goal: one ops console covering twelve technologies — Docker, PostgreSQL, MySQL, SQL Server, MongoDB, Kafka, Kubernetes, Redis, Qdrant, Cloudflare R2, MinIO and Amazon S3 — each workspace modelled on the dedicated tool people already use (Portainer-grade Docker, pgAdmin-grade Postgres, kafka-ui-grade Kafka, and so on). One console, all the layers.

## Done
- Connection management for all twelve techs. Connections live in a `globalThis` store mirrored to `~/.baklava/connections.json`, **encrypted at rest** (AES-256-GCM envelope). Server-side auth sessions, multi-user accounts and per-connection RBAC (`admin` / `member`) sit on top, enforced in `src/proxy.ts` as defense-in-depth.
- Docker workspace: containers (list, start/stop/restart/remove, logs, inspect, env, mounts), images (list, pull, remove), volumes (list, create, remove), networks (list, remove).
- Postgres workspace: tree (db→schema→tables/views), table tabs (Data/Structure/Indexes/Constraints/FKs), SQL editor.
- Kafka workspace: topics (list, create, delete, partitions, configs, messages, produce), consumer groups (list+detail with lag), brokers.
- Theming: warm honey-amber accent, light/dark/system via custom theme provider + server-rendered no-flash script, Instrument Serif accents, JetBrains Mono.

## Phase 1 — Docker Hub registry (done)
- Search Docker Hub from the Images page. Results: name, description, stars, official / publisher badge.
- Browse tags for any image (last_updated, size, architectures).
- Pull with live SSE progress — per-layer status streamed from dockerode.

## Phase 2 — Container creation + observability (done)
- Create container form — image picker (datalist of local images), name, command, ports, env, volume mounts, restart policy, auto-start.
- Stats tab — CPU%, memory, network I/O, block I/O, PIDs (auto-refreshes every 3s).
- Exec — run-command form (one-shot) with shell selector, stdout/stderr panes, exit code. Full xterm.js terminal deferred to Phase 4.
- Pause / unpause action in container detail header.

## Phase 3 — System + cleanup (done)
- System dashboard — server / API versions, kernel, OS, architecture, storage driver, root dir, container/image counts, CPU/memory totals.
- Prune — containers / images / volumes / networks / build-cache, with confirm dialogs. Reports items deleted + space reclaimed.

## Phase 4 — Portainer parity (done)
- Network create form — name, driver (bridge/overlay/macvlan/ipvlan), optional subnet, internal flag.
- Live event stream — SSE `docker events` feed with type-coded badges, filter, pause/resume, clear.
- Image build from Dockerfile — paste Dockerfile + tag, build via in-memory POSIX-tar, SSE stream of build output.
- Container ↔ network connect/disconnect — Networks tab on container detail with IP / gateway / MAC / aliases, disconnect button, "Connect to network" dialog (picks from unconnected networks).
- Container file browser — Files tab on container detail. Portable busybox-friendly listing (handles alpine without `find -printf`), breadcrumb nav, click directories to descend, click files to preview (text auto-detected, 64 KB cap, base64 transport for binary safety).
- Full xterm.js terminal — true bidirectional shell. SSE for stdout/stderr, POST for stdin, in-memory session map keyed by sessionId, resize support that wires xterm's onResize → daemon. Theme'd to match (honey cursor, JetBrains Mono).
- Registry credentials — per-connection in-memory store (never persisted), auto-attach to pulls based on image-ref domain. Page lists creds, dialog adds with presets for Docker Hub / GHCR / Quay / ECR.

## Phase 5 — Compose stacks (done)
- Compose parser (`yaml`) for `services` (with `image`, `command`, `environment`, `ports`, `volumes`, `networks`, `depends_on`, `restart`, `container_name`), top-level `networks` and `volumes`. Out of scope for now: `build:`, `secrets`, `configs`, `profiles`, `healthcheck` waits, `scale`/`replicas`.
- Validate endpoint that returns the parsed plan (services, networks, volumes, warnings) so the UI can preview before deploy.
- Deploy as SSE — phases `networks → volumes → pull → create → start → done`, per-service status events. Topological sort on `depends_on`. Idempotent on re-deploy (stale containers with the stack name are removed first). Auto-attaches registry credentials when pulling private refs.
- Tracking: containers / networks / volumes labelled with `baklava.stack.name` and `baklava.stack.service`. List / detail / teardown all filter by these labels (clean separation from any compose CLI deployments).
- UI: Stacks sidebar item, list page, composer page (paste + validate preview + deploy with live log + per-service status pills), detail page (services table linking into individual containers, networks, volumes, header Restart / Stop / Remove with optional volume-removal checkbox).

## Postgres Phase 1 — Row CRUD (done)
- `insertRow` / `updateRow` / `deleteRow` helpers in `src/lib/connections/postgres.ts` with quoted identifiers and parameterized values; tagged-union `ColumnValue` distinguishes `null` / `default` / literal value.
- New API route `POST/PATCH/DELETE /api/postgres/[id]/databases/[db]/schemas/[schema]/tables/[table]/rows`.
- Shared row form dialog: per-column input with null toggle, default toggle (insert only), boolean pills, textarea for `text`/`json`/`jsonb`. Pre-populates on edit from the current row.
- Data tab: Insert button in toolbar, hover-revealed Edit / Delete on every row, AlertDialog confirm on delete. Edit/Delete disabled when the table has no primary key. Refresh after every mutation.

## Postgres Phase 2 — DDL & ops (done)
- Create table from UI (done): per-schema hover-revealed "+" in the sidebar tree opens a column-driven `CREATE TABLE` dialog — name, type, nullable, default, PK (multi-checkbox = composite PK), `IF NOT EXISTS`. Identifiers quoted via `quoteIdent`; type and default are SQL expressions (`varchar(50)`, `numeric(10,2)`, `now()`, `gen_random_uuid()`) so users aren't boxed in. New `createTable()` helper in `src/lib/connections/postgres.ts`, `POST /api/postgres/[id]/databases/[db]/schemas/[schema]/tables`, `<CreateTableDialog>` co-located with the sidebar.
- EXPLAIN visualizer in the SQL editor (done): `src/components/postgres/explain-plan-viewer.tsx`, wired as a fourth result tab in `query-editor-client.tsx` against a dedicated endpoint that wraps the user SQL in `EXPLAIN (…, FORMAT JSON)`.
- Activity sidebar entry (done): `src/app/postgres/[connectionId]/activity/` — `pg_stat_activity` + `pg_terminate_backend`.
- Roles sidebar entry (done): `src/app/postgres/[connectionId]/roles/` — `pg_roles`.

## Stretch — other techs
- Kafka: schema registry, ACLs, message search/filter, consumer-group offset reset.
- New techs to add (one driver each, same workspace pattern): MQTT. Redis and MongoDB shipped — both are registered tech modules under `src/techs/` with full workspaces.
- Command palette coverage is 11 of 12: `src/techs/redis/meta.ts` declares no `commandObjects`, so Redis keys aren't reachable from ⌘K (verify with `grep -L commandObjects src/techs/*/meta.ts`). Kubernetes objects are reachable — its tables have no per-object route, but they honour `?ns=` + `?select=`, which is what its provider links to.

## SQL workspace refactor

- **Phase 1 — driver split + safety net (done, 2026-08-08).** `postgres.ts` and
  `sqlserver.ts` became `<tech>/` directories of focused modules behind a
  barrel, with cross-module privates in `<tech>/internal.ts`, and each SQL
  table-detail client gained a characterization suite.
  Plan: `docs/superpowers/plans/2026-08-08-sql-refactor-phase-1.md`.
- **Phase 2 — shared workspace layer (this cycle).** A real error surface in
  all three SQL table workspaces (`ErrorState` + Retry), then the shared
  primitives in `src/components/workspace/sql/` (`StructurePanel`, `DdlPanel`,
  `DataGrid` / `GridToolbar` / `filterRows`, `MetaTable`, one `RowFormDialog`
  with per-tech dialects), then the `SqlTableDetail` shell all three clients
  compose with a descriptor. Closed the two capability gaps — SQL Server
  per-row edit/delete, MySQL Constraints and Foreign keys — and gave MySQL a
  compose service and seed script so any of it can run against a real server.
  Plan: `docs/superpowers/plans/2026-08-09-sql-refactor-phase-2.md`.
- **Phase 3 — query-editor convergence (deferred, not dropped).** The three
  query editors (1086 / 1273 / 734 lines) share a CodeMirror setup, result
  grid, statement splitter and history strip, but diverge on a different axis
  from table-detail — editor extensions and history, not fetch strategy — so
  they need their own descriptor and their own plan. See Phase 2's Scope
  section for the full reasoning.
