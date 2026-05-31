<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Baklava

Open-source unified ops console for Docker, Kafka, PostgreSQL (and more to come). Each tech has its own workspace modeled on the dedicated tool people already use (Docker Desktop / kafka-ui / pgAdmin).

## Stack

- Next.js 16 (App Router) with Turbopack, React 19, TypeScript
- Tailwind v4, shadcn/ui (`base-nova` style — components wrap `@base-ui/react/*`, NOT classic Radix)
- Drivers: `dockerode`, `kafkajs`, `pg`
- Editors: `@uiw/react-codemirror` (SQL editor) and `@xterm/xterm` + `@xterm/addon-fit` (container terminal)
- No DB. Connections live in an in-memory store on `globalThis` and are mirrored to `~/.baklava/connections.json` (override with `BAKLAVA_DATA_DIR`) so they survive Next.js restarts. Per-connection volatile state (terminal sessions, registries, etc.) still vanishes on restart.

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

`src/lib/connections/postgres.ts` is the only place that builds SQL. Three rules:

1. **Identifiers** (table / column / schema / role / index names): `quoteIdent(name)` — wraps in `"…"` and doubles internal `"`. `validateIdentifier(name, kind)` additionally enforces `^[A-Za-z_][A-Za-z0-9_]*$` for user-supplied names.
2. **Values**: parameterized queries (`$1, $2, …`). Never interpolate.
3. **Free-form SQL fragments** — column data-types, `DEFAULT` expressions, `USING` clauses, partial-index `WHERE`, `DROP FUNCTION` arg signatures — must go through `requireNoStatementTerminator(value, fieldName)`, which rejects `;`. `;` is the only character that lets pg's simple-query path execute a second statement, so blocking it is the SQLi guard for these fields.
4. **User-pasted SQL in the query editor** (`runQuery`) is intentionally unrestricted — that's the feature.

**Known design gap (deferred)**: `withClient` opens a fresh `pg.Client` per call (TCP+TLS+auth round-trip every time). The intended architecture is a cached `pg.Pool` per connection record with `pool.end()` in `deleteConnection`. Don't propose this as a quick fix in-flight — it touches every postgres exported function.

## UI conventions (base-ui, not Radix)

shadcn wrappers in `src/components/ui/` re-export `@base-ui/react/*` primitives. The escape-valve API is different from classic Radix:

- **No `asChild`.** Anywhere classic Radix would take `<Comp asChild><Link/></Comp>`, base-ui takes `render={<Link/>}` on the primitive. shadcn's `AlertDialogCancel`, `DialogClose`, and `SheetClose` already do this internally (`render={<Button … />}`).
- **To make a `Link` look like a button**: style the `Link` directly (compose `buttonVariants({...})` from `@/components/ui/button` if desired). Do not wrap it in `<Button asChild>`.
- **Animations** key off `data-open` / `data-closed` data attributes (not Radix's `data-state`). Match these when writing custom transitions.
- **Dialogs use imperative open state** — keep a `[open, setOpen]` and bind it to the `<Dialog open onOpenChange>` props. Don't reach for the (nonexistent) `DialogClose asChild` pattern.
- Add new shadcn components via `npx shadcn@latest add <component> --yes`. They drop into `src/components/ui/` and need no further wiring.

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
- **Native server packages**: register them in `next.config.ts` `serverExternalPackages` (already lists `dockerode`, `ssh2`, `kafkajs`, `pg`). Turbopack will refuse to bundle `ssh2`'s native crypto otherwise.

## Driver lifecycle

- **Kafka**: every helper does `client.admin/consumer/producer → connect → try → finally disconnect()`. `fetchMessages` additionally creates an ephemeral consumer group (`baklava-browse-${ts}-${rand}`) and **must** `admin.deleteGroups([groupId])` in `finally` so it doesn't accumulate as durable broker state.
- **Docker**: dockerode hijacked streams (logs, exec, terminal, events) need explicit `stream.destroy?.()` on `req.signal.abort`. Terminal sessions are kept in `terminal-sessions.ts` keyed by `sid`; `dropConnectionSessions(connectionId)` enumerates and ends them all (called from `DELETE /api/connections/[id]`).
- **Compose deployment** (`src/lib/connections/compose.ts`): every created container / network / volume gets the `baklava.stack.name`, `baklava.stack.service`, `baklava.stack.role` labels. `listStacks` / `getStack` / `stackAction` / `teardownStack` all filter by these labels — never assume name-based reconstruction.

## Adding a new technology

1. Add a `TechId` literal in `src/lib/connections/types.ts` and a config interface.
2. Add a catalog entry in `src/lib/tech-catalog.ts` (icon, gradient, tagline, `simpleicons.org` slug).
3. Add a `connectionSummaries[tech]` entry in `src/lib/connections/summaries.ts`.
4. Drop a driver helper in `src/lib/connections/<tech>.ts` (probe + per-object operations). Mirror the Kafka/Docker connect-try-finally-disconnect pattern.
5. If the driver is a native package, add it to `serverExternalPackages` in `next.config.ts`.
6. Add API routes under `src/app/api/<tech>/` (`test`, `[id]/...`). Use `formatError`. SSE routes follow the streaming pattern above.
7. Build the form at `src/app/<tech>/<tech>-form.tsx` (reused by `ConnectionSheet`; there is no standalone `/<tech>` page).
8. Build the workspace at `src/app/<tech>/[connectionId]/`:
   - `layout.tsx` with `<WorkspaceShell>` and a sidebar of `<SidebarLink>`s (or a custom tree, like Postgres).
   - One page per object kind, optionally with a `[id]` detail subpage and `*-client.tsx` sibling.
9. Add the tech to `FIRST_PAGE` in `src/components/connection-tabs.tsx` so the workspace tab opens at the right initial route.

## Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # eslint (react-hooks/set-state-in-effect is intentionally off)
```

For real services to point Baklava at, see the `docker run` snippets in `README.md`.
