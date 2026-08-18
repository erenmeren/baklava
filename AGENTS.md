<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Baklava

Open-source unified ops console for 12 technologies: Docker · PostgreSQL · MySQL · SQL Server · MongoDB · Kafka · Kubernetes · Redis · Qdrant (vector) · Cloudflare R2 · MinIO · Amazon S3. Each tech has its own workspace modeled on the dedicated tool people already use.

## Stack

- Next.js 16 (App Router) with Turbopack, React 19, TypeScript
- Tailwind v4, shadcn/ui (`base-nova` style — components wrap `@base-ui/react/*`, NOT classic Radix)
- Drivers: `dockerode`, `kafkajs`, `pg`
- Editors: `@uiw/react-codemirror` (SQL editor) and `@xterm/xterm` + `@xterm/addon-fit` (container terminal)
- No DB. Connections live in an in-memory store on `globalThis` and are mirrored to `~/.baklava/connections.json` (override with `BAKLAVA_DATA_DIR`) so they survive Next.js restarts; the JSON files are **encrypted at rest** (AES-256-GCM envelope; master key resolved via `BAKLAVA_MASTER_KEY` env → OS keychain → `~/.baklava/master.key`). Per-connection volatile state (terminal sessions, registries, etc.) still vanishes on restart. **Auth sessions** are server-side records in `~/.baklava/sessions.json` (revocable; sliding 7d idle / 30d absolute cap); the auth cookie carries `<sessionId>.<hmac>` — not the password hash.

**Multi-user / RBAC.** Users are records in `~/.baklava/users.json` (`src/lib/auth/users.ts`); per-connection grants in `~/.baklava/connection-access.json` (`src/lib/connections/access.ts`) — both encrypted-at-rest like the rest. Two roles: `admin` (all connections + manages users) and `member` (only granted connections). A session carries a `userId`; `getCurrentUser(req)` resolves it. `effectiveAccess({user, conn})` → `admin`/owner ⇒ `write`, else the explicit grant or `none`. `src/proxy.ts` enforces it as defense-in-depth on every connection-scoped path (`/api/connections/<id>/…`, `/api/ai/connections/<id>/…`): `none` ⇒ 403 (read floor — members can't reach a connection by guessing its URL), plus a write floor — mutating the connection resource itself (`PUT/PATCH/DELETE` on exactly `/api/connections/<id>`) needs `write`. The AI gate (`src/lib/ai/gate.ts`) **ANDs** per-connection policy with the acting user's `effectiveAccess` (reads need ≥`read`, writes/destructive need `write`; fail-closed on `none`). **Legacy migration**: on first load with an existing `auth.json` password and no `users.json`, an `admin` user named `admin` is created reusing the legacy hash+salt (existing password keeps working), then all sessions are revoked. Login (`/api/auth/login`) accepts password-only while exactly one enabled user exists; otherwise username+password.

## Routing model

- `/` — home grid of integrated technologies (`src/lib/tech-catalog.ts`).
- Connection management lives entirely in the home-screen Sheet (`ConnectionSheet`); there is **no** standalone `/[tech]` page. Each `src/app/<tech>/` dir holds only the `[connectionId]` workspace and the reused `<tech>-form.tsx`.
- `/[tech]/[connectionId]/...` — workspace with sidebar. Pattern:
  - `layout.tsx` reads the connection via `requireConnection<C>(id, tech)` from `src/lib/connections/server.ts` (404s if missing) and renders `<WorkspaceShell>` with a tech-specific sidebar.
  - Each section (containers, topics, tables…) is its own page.
  - Detail pages use shadcn `Tabs` (Data / Structure / Indexes / Logs / Messages / etc.).
  - Postgres workspaces additionally render a per-connection localStorage-backed tab strip (`postgres-tabs.tsx`).

## In-memory stores (globalThis pattern)

All persistent-feeling state is held in `Symbol.for("baklava.X")` slots on `globalThis` so it survives Next dev HMR:

- `src/lib/connections/store.ts` — `baklava.connectionStore` (connections for every tech). **Persists to `~/.baklava/connections.json`** on `saveConnection` / `deleteConnection`. `updateStatus` is in-memory only (it fires on every API request — flushing each one would thrash the disk). Loaded on first `getStore()` call after process restart.
- `src/lib/connections/registries.ts` — `baklava.registries` (Docker registry creds per connection). In-memory only.
- `src/lib/connections/terminal-sessions.ts` — `baklava.terminalSessions` (hijacked dockerode exec streams). In-memory only.

`src/lib/connections/store.ts` is the single source of truth for connections. Use `redactConfig` / `publicView` before returning over the API — **passwords never leave the server**.

## API routes

All under `src/app/api/`. They follow the convention:
- `POST /api/<tech>/test` — probe connection, optionally save
- `GET /api/<tech>/[id]/...` — read operations
- `POST /api/<tech>/[id]/...` — actions (start container, produce message, run query)
- `DELETE /api/<tech>/[id]/...` — destructive ops

Every route file should start with `export const runtime = "nodejs";` (we need Node APIs for the drivers).

**Error formatting**: always wrap thrown errors with `formatError(err)` from `src/lib/errors.ts` — raw `Error.message` is often empty for `AggregateError` / `ECONNREFUSED`. The helper unwraps `AggregateError.errors`, includes `code` for `ECONN*`, and falls back to `err.name`.

**Cascading deletes**: `DELETE /api/connections/[id]` calls `deleteConnection(id)` *and* `dropConnectionSessions(id)` — adding more globalThis state means adding another teardown call here too.

**Connection-access gate (RBAC)**: Any API route that resolves a connection by id MUST be covered by the proxy `connectionIdFromPath` matcher (`src/proxy.ts`) OR perform its own `effectiveAccess` check (404 on `none`, matching the CRUD GET convention in `src/app/api/connections/[id]/route.ts`). Connection-scoped routes whose first path segment is **not** a tech id / `connections` / `ai` are **not** auto-gated — the generic `/api/<tech>/<id>` proxy branch only fires for known tech ids. When adding such a route (e.g. `dashboard`), add its prefix to `connectionIdFromPath` *and* add a handler-level check (defense in depth).

**Write floor**: `src/proxy.ts` requires `write` for every mutating method (`POST/PUT/PATCH/DELETE`) on a connection-scoped path — a `read` grant means read. The exception is `READ_SHAPED_POSTS`, a short allowlist of POSTs that only read because the query travels in the body (Kafka topic search, Qdrant search, mongo distinct/explain, docker `fs/list`+`fs/cat`), plus `mongo/.../documents`, which dispatches on `?action=` and is a read only when that is `find`. **Verify against the handler before adding an entry** — several routes that look like reads are not: `/query` and `redis/<id>/command` run free-form statements, `postgres/.../explain` defaults to EXPLAIN ANALYZE (which executes), `mongo/.../aggregate` accepts `$out`/`$merge`, `kafka/.../messages` produces. Forgetting an entry costs a member a read; a wrong entry hands them a write.

**Session-id routes**: the proxy only gates the connection id in the *path*. A route addressed by an opaque session id (`/api/kubernetes/<id>/exec/<sid>/…`, `/api/docker/<id>/containers/<cid>/terminal/<sid>/…`) must additionally check that the stored session's own `connectionId` (and `containerId`, where the path carries one) match the path, and 404 otherwise — without it, anyone with access to one connection can reach every other connection's live sessions. Session ids are `randomUUID()`, never `Math.random()`.

**AI tool gate** (`src/lib/ai/gate.ts`): beyond per-connection policy + approval, `wrapExecute` enforces a persisted global kill switch (`~/.baklava/ai-controls.json`, toggled from the assistant header) plus in-memory per-session rate limit, destructive circuit breaker, and tool-call budget (`src/lib/ai/limits.ts`); reads are never blocked by the kill switch or breaker. **Destructive approval is non-disableable** — `needsApproval` in `src/lib/ai/permissions.ts` always returns `true` for destructive actions regardless of mode; each approval carries a `risk` assessment (low/medium/high + reasons) from `src/lib/ai/risk.ts`, and high-risk approvals require typing the connection name before the Approve button enables. **Plan mode** (opt-in per conversation) injects a directive plus a `propose_plan` tool (`src/lib/ai/plan-tool.ts`) that emits a `plan` SSE event and awaits approval through the existing pending infra (`createPending`); it is purely additive and never bypasses the gate, kill switch, rate limit, policy, or RBAC-access checks.

**Egress policy** (`src/lib/net/egress.ts`): user-supplied target hosts (load-test URL, health reachability probe) pass through `assertHostAllowed`, which resolves the hostname, pins the resulting IP, and blocks cloud-metadata ranges (`169.254.169.254`, `fd00:ec2::254`) and link-local addresses; private/loopback targets are allowed; `BAKLAVA_EGRESS_ALLOW=<ip,ip>` re-allows specific IPs.

### SSE / streaming routes

The pattern (see `src/app/api/docker/[id]/events/route.ts`, `.../stacks/deploy/route.ts`, `.../images/{build,pull}-stream/route.ts`):

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// inside the handler:
const stream = new ReadableStream<Uint8Array>({
  async start(controller) {
    const safeEnqueue = (chunk: Uint8Array) => {
      try { controller.enqueue(chunk); } catch { /* closed */ }
    };
    // 15s heartbeat keeps Next dev / proxies from dropping the connection
    const heartbeat = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), 15_000);

    req.signal.addEventListener("abort", () => {
      clearInterval(heartbeat);
      upstream?.destroy?.();
      try { controller.close(); } catch {}
    });
    // ... wire onData / onError / onEnd to safeEnqueue(sse("name", payload))
  },
});
return new Response(stream, { headers: {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
}});
```

Wire format: `event: <name>\ndata: <json>\n\n`. Client uses `EventSource` + `addEventListener("<name>", ...)`.

## Postgres SQL safety

SQL is built across `src/lib/connections/postgres/{sql,catalog,rows,ddl,query,ops,backup}.ts` — `postgres.ts` is now a ~15-line barrel re-exporting them (see "Large drivers" below). Three rules:

1. **Identifiers** (table / column / schema / role / index names): `quoteIdent(name)` — wraps in `"…"` and doubles internal `"`. `validateIdentifier(name, kind)` additionally enforces `^[A-Za-z_][A-Za-z0-9_]*$` for user-supplied names.
2. **Values**: parameterized queries (`$1, $2, …`). Never interpolate.
3. **Free-form SQL fragments** — column data-types, `DEFAULT` expressions, `USING` clauses, partial-index `WHERE`, `DROP FUNCTION` arg signatures — must go through `requireNoStatementTerminator(value, fieldName)`, which rejects `;`. `;` is the only character that lets pg's simple-query path execute a second statement, so blocking it is the SQLi guard for these fields.
4. **User-pasted SQL in the query editor** (`runQuery`) is intentionally unrestricted — that's the feature.

**Connection pooling**: `withClient` acquires a client from a cached `pg.Pool` per connection+database (globalThis-keyed by host/port/user/ssl/password-hash, `max:5`, `idleTimeoutMillis:30000`, `pool.on('error')` guarded, `release(true)` to discard a client after an error). `dropPostgresPools(config)` ends all pools for a connection and is called from the `DELETE /api/connections/[id]` cascade.

## Large drivers (module split)

`postgres.ts` and `sqlserver.ts` outgrew a single file, so each is now a `<tech>/` directory of focused modules (`client`, `sql`, `catalog`, `rows`, `ddl`, `query`, `ops`, `backup`) behind a barrel at the original path (`src/lib/connections/<tech>.ts`) — that barrel exists purely so the existing ~80 import sites across both drivers didn't have to change. **New code should import the specific module** (e.g. `@/lib/connections/postgres/catalog`) **rather than the barrel.** Cross-module private helpers that don't belong to the public surface (lazy driver-import guards, connection-pool internals, etc.) live in `<tech>/internal.ts`, which the barrel deliberately does **not** re-export, keeping them off the public surface.

## UI conventions (base-ui, not Radix)

shadcn wrappers in `src/components/ui/` re-export `@base-ui/react/*` primitives. The escape-valve API is different from classic Radix:

- **No `asChild`.** Anywhere classic Radix would take `<Comp asChild><Link/></Comp>`, base-ui takes `render={<Link/>}` on the primitive. shadcn's `AlertDialogCancel`, `DialogClose`, and `SheetClose` already do this internally (`render={<Button … />}`).
- **To make a `Link` look like a button**: style the `Link` directly (compose `buttonVariants({...})` from `@/components/ui/button` if desired). Do not wrap it in `<Button asChild>`.
- **Animations** key off `data-open` / `data-closed` data attributes (not Radix's `data-state`). Match these when writing custom transitions.
- **Dialogs use imperative open state** — keep a `[open, setOpen]` and bind it to the `<Dialog open onOpenChange>` props. Don't reach for the (nonexistent) `DialogClose asChild` pattern.
- Add new shadcn components via `npx shadcn@latest add <component> --yes`. They drop into `src/components/ui/` and need no further wiring.

### Kubernetes workspace

- **One catalogue** (`src/lib/kubernetes/commands.ts`) drives the sidebar groups, the `:` command vocabulary, the palette suggestions and the digit hotkeys. Adding a resource means adding a `K8S_RESOURCES` entry (+ driver list, page, view) — not editing four lists.
- **Mapping lives in pure functions** (`mappers.ts`, `workload-mappers.ts`, `describe.ts`, `quantity.ts`), not in the driver, so the interesting logic is unit-tested without a cluster. The driver fetches and maps; it does not interpret.
- **Namespace travels in the URL** (`?ns=`), resolved by `resolveNamespace(param, cfg.namespace)`. Server components scope their list call with it — a namespace-restricted kubeconfig 403s on the cluster-wide list endpoints, so filtering rows in the browser is not a substitute.
- **Lists are bounded** (`LIST_LIMIT`, `toList` → `K8sList<T>`) and truncation is *visible*: `ResourceTable` renders the "showing the first N" banner from `truncated`/`remaining`. Never let a capped list look complete.
- **Mutations patch, never read-modify-replace.** Scale, restart and cordon send a strategic-merge PATCH. A Deployment's or Node's `status` is rewritten continuously by its controller, so a read-then-replace loses the race with a 409 exactly when the object is busy — which is when you are acting on it. `kubectl` patches for the same reason.
- **Secret values need `write`.** `GET /yaml/secret/<name>` redacts for a `read` grant, matching the AI gate's `allowK8sSecretValues` stance; `describe` prints a Secret's *keys* and never its values, and strips `kubectl.kubernetes.io/last-applied-configuration` on every kind (that annotation mirrors the whole manifest, base64 `data` included).
- **Verified against a real cluster.** `docker compose up -d k3s && bash seed/kubernetes.sh`, then `npm run test:integration` (driver) and `npx playwright test e2e/kubernetes-workspace.spec.ts` (workspace). k3s bundles metrics-server, so the usage columns have real data. Both suites skip loudly when the cluster is down.
- **Pod reachability is an HTTP proxy, not port-forward.** `proxyPodHttp` GETs through the API server's `pods/<name>:<port>/proxy` subresource: no local listener, the connection's own credentials, and it works when Baklava runs on a server rather than the viewer's machine — which is exactly where `kubectl port-forward` breaks down, since the socket it opens would be on the host, not the browser. Non-HTTP ports (a database in the cluster) are out of reach by design. The route requires **`write`** even though it is a GET: Kubernetes treats `pods/proxy` as privileged, and Baklava cannot know whether a given pod treats a GET as a read.
- **`ResourceTable` stays generic.** Resource-specific actions arrive as `rowActions` (key, label, render) from the view — the table owns the key binding and overlay state. No `kind === "…"` conditionals inside it.

### Shared SQL workspace layer (`src/components/workspace/sql/`)

The three SQL table-detail workspaces (postgres / mysql / sqlserver) are **not** hand-rolled. Each `table-detail-client.tsx` is a descriptor plus its own dialogs, composed onto one shell:

- **`<SqlTableDetail descriptor ctx>`** owns tab state, the fetch dispatch, `AbortController` wiring, the error map and its `ErrorState` rendering, Retry, the whole Data tab (toolbar, grid, row actions, pagination), and refresh-after-mutation. New SQL workspace UI composes it — don't write another table-detail client.
- **`descriptor.ts`** carries the per-tech parts: `tabs`, `capabilities`, `paths`, `load` (named **sources** — one request, fetched at most once, feeding any number of tabs), `data` (the rows adapter), and `render` / `toolbar` / `skeleton` per tab. Per-tech behaviour arrives here or through the row dialect — **never** as a `tech === "…"` conditional inside a shared primitive.
- **Panels**: `StructurePanel`, `DdlPanel`, `MetaTable`, `DataGrid` / `GridToolbar` / `filterRows`, and one `RowFormDialog` parameterized by a per-tech dialect object co-located with each client (`row-dialect.tsx`). `SqlColumn` (`sql/types.ts`) is the normalized column model they all read.
- **Per-tech panels live in their own co-located file** next to the client (`stats-grid.tsx`, `meta-columns.tsx`, `index-dialogs.tsx`, `table-actions.tsx`, `table-types.ts`), not as a tail on the client.
- **`ErrorState`** (`src/components/workspace/error-state.tsx`) is the one error surface. It renders `role="alert"` plus the `text-destructive` class token — `e2e/sql-workspaces.spec.ts` asserts on exactly that pair, so don't change either without updating the spec.
- **`ConfirmDialog`** (`src/components/workspace/confirm-dialog.tsx`) is the shared "…? This cannot be undone." confirm for delete-row / truncate / drop.
- **Tab strips** use `useTableTabs` (`@/components/workspace/use-table-tabs`) for the localStorage-backed hydrate / persist / auto-add / close-with-fallback logic. The middle-click and stale-tab-pruner notes above still apply — they describe the strip components, not the hook.

## Conventions to follow

- **Server pages**: `await params` (Next 15+ Promise-shaped params), then call `requireConnection`. Client logic lives in sibling `*-client.tsx`; the page hands over `connectionId` and route params.
- **Workspace chrome**: render through `<WorkspacePage title description actions>` for the title bar + scroll container.
- **Workspace shell**: `<WorkspaceShell tech connectionName subtitle sidebar>` wraps every `/[tech]/[connectionId]/...` route via its `layout.tsx`.
- **Tab strips** (header `ConnectionTabs`, postgres `PostgresTabs`):
  - State persisted to `localStorage` (keys: `baklava:open-tabs`, `baklava:pg-tabs:${connectionId}`).
  - Middle-click closes a tab: `onMouseDown` (preventDefault on `button === 1`) + `onAuxClick` (preventDefault + close handler). The `onMouseDown` half stops the browser from opening a new browser tab on the underlying `<Link>`.
  - Stale-tab pruner gates on a `fetched` flag, **not** `conns.length > 0` — a transient partial response would otherwise wipe tabs.
- **`RelativeTime`** (`src/components/workspace/relative-time.tsx`): renders empty until the `useEffect` mount flag flips. Don't replace it with a raw `relativeTime(value)` call in a `"use client"` component — `Date.now()` differs between SSR and the first client render and React 19 will warn.
- **SSE clients**: store the `EventSource` in a ref and add a dedicated unmount `useEffect(() => () => sourceRef.current?.close(), [])`. Don't rely on an `if (!open)` effect to handle unmount.
- **Abort in-flight fetches** the same way: `useEffect(() => () => abortRef.current?.abort(), [])`.
- **Native server packages**: `serverExternalPackages` in `next.config.ts` is **generated** from each tech module's `serverPackages` by `scripts/gen-server-packages.ts` (runs on `prebuild`/`predev`, writes `src/techs/server-packages.generated.ts`). Declare a tech's native deps in its `meta.ts` `serverPackages` — don't hand-edit `next.config.ts`. Turbopack will refuse to bundle native crypto (e.g. `ssh2`) otherwise.

## Driver lifecycle

- **Kafka**: every helper does `client.admin/consumer/producer → connect → try → finally disconnect()`. `fetchMessages` additionally creates an ephemeral consumer group (`baklava-browse-${ts}-${rand}`) and **must** `admin.deleteGroups([groupId])` in `finally` so it doesn't accumulate as durable broker state.
- **Docker**: dockerode hijacked streams (logs, exec, terminal, events) need explicit `stream.destroy?.()` on `req.signal.abort`. Terminal sessions are kept in `terminal-sessions.ts` keyed by `sid`; `dropConnectionSessions(connectionId)` enumerates and ends them all (called from `DELETE /api/connections/[id]`).
- **Compose deployment** (`src/lib/connections/compose.ts`): every created container / network / volume gets the `baklava.stack.name`, `baklava.stack.service`, `baklava.stack.role` labels. `listStacks` / `getStack` / `stackAction` / `teardownStack` all filter by these labels — never assume name-based reconstruction.

## Tech module architecture (`src/techs/`)

A technology is one self-contained **module** under `src/techs/<tech>/`, collected by two registries. Core derives catalog, summaries, `FIRST_PAGE`, secret keys, health probes, command-palette providers, and `serverExternalPackages` **from the registry** — so adding a tech is create-module + register, not a 9-file diff.

- **`<tech>/meta.ts`** — `export const <tech>Meta: TechModuleMeta<C>`: `catalog`, `config` (zod `schema` + `secretKeys`), `summary`, `firstPage`, `optionalDeps`, `serverPackages`, optional `capabilities` + `commandObjects`. **CLIENT-SAFE — must NOT import driver code.** It is reached by the home grid and command palette.
- **`<tech>/index.ts`** — `export const <tech>: TechModule<C> = { ...<tech>Meta, driver: { probe, health } }`. **Server-only** — imports the driver, which lazy-imports its npm package behind a `get<Pkg>()` guard that throws `DriverNotInstalledError` (template: `src/lib/connections/postgres/internal.ts`'s `getPg`/`getPgCursor`).
- **`registry.ts`** (server, full modules) vs **`meta-registry.ts`** (client-safe metadata). **Client components import `@/techs/meta-registry`; server code imports `@/techs/registry`.** Never import a `<tech>/index.ts` or the server `registry.ts` from a client component — it pulls Node-only driver packages into the client bundle and breaks the build.
- `contract.ts` defines `TechModuleMeta` (client) + `TechDriver` (server) + `TechModule = TechModuleMeta & { driver }`. `DriverNotInstalledError` lives here; `errorResponse` in `src/lib/errors.ts` maps it to 503.

### Adding a new technology

1. Add a `TechId` literal in `src/lib/connections/types.ts` and a config interface. `TechId` is the hand-maintained source of truth; the registry is typed `Record<TechId, …>` so `tsc` fails if a tech has no module.
2. Create `src/techs/<tech>/meta.ts` (client-safe metadata — no driver import).
3. Create `src/techs/<tech>/index.ts` (spreads meta + adds `driver`). Put the driver helper in `src/lib/connections/<tech>.ts` (probe + per-object ops, Kafka/Docker connect-try-finally-disconnect pattern) and **lazy-import its npm package** so the dependency is optional. If the driver outgrows one file, split it into a `<tech>/` directory behind a barrel — see "Large drivers" above.
4. Register in BOTH `src/techs/registry.ts` (full module) and `src/techs/meta-registry.ts` (meta) — one line each.
5. Add the npm driver to `optionalDependencies` in `package.json`. `serverExternalPackages` is generated from module `serverPackages` by `scripts/gen-server-packages.ts` (runs on `prebuild`/`predev`) — do **not** hand-edit `next.config.ts`.
6. Add API routes under `src/app/api/<tech>/` (`test`, `[id]/...`). Use `formatError`; the lazy guard surfaces "Run: npm i <pkg>" when the driver is absent. SSE routes follow the streaming pattern above.
7. Build the form at `src/app/<tech>/<tech>-form.tsx` and the workspace at `src/app/<tech>/[connectionId]/` (`layout.tsx` with `<WorkspaceShell>` + sidebar; one page per object kind, optional `[id]` detail + `*-client.tsx` sibling).

Catalog, `connectionSummaries`, `FIRST_PAGE`, secret keys, health probes, and command-palette providers all derive from the registry automatically — do **not** edit them per tech.

## Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # eslint (react-hooks/set-state-in-effect is intentionally off)
npm test         # vitest
```

Local stack + demo data:

```bash
docker compose up -d              # postgres, mysql, sqlserver, kafka
bash seed/all.sh                  # or per-tech: bash seed/mysql.sh
npm run test:integration          # vitest suites gated on TCP reachability
npx playwright test               # e2e
```

`compose.yaml` also carries a `k3s` service (single-node Kubernetes, kubeconfig written to `.kube/kubeconfig.yaml`); `seed/kubernetes.sh` fills its `demo` namespace. `compose.yaml` carries a `mysql` service (mysql:8.4, port 3306, root / `Baklava123!`); `seed/mysql.sh` creates the `demo` storefront the MySQL workspace and its e2e block target. For services outside compose, see the `docker run` snippets in `README.md`.
