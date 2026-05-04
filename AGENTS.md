<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Baklava

Open-source unified ops console for Docker, Kafka, PostgreSQL (and more to come). Each tech has its own workspace modeled on the dedicated tool people already use (Docker Desktop / kafka-ui / pgAdmin).

## Stack

- Next.js 16 (App Router) with Turbopack, React 19, TypeScript
- Tailwind v4, shadcn/ui (Radix preset, Nova theme — components are wrapped from `@base-ui/react/*`, not classic Radix)
- Drivers: `dockerode`, `kafkajs`, `pg`
- No DB. Connections live in an in-memory store on `globalThis` and vanish on server restart. This is intentional.

## Routing model

- `/` — home grid of integrated technologies (`src/lib/tech-catalog.ts`).
- `/[tech]` — connection management page (form + saved connections list). Click "Open" → workspace.
- `/[tech]/[connectionId]/...` — workspace with sidebar. Pattern:
  - `layout.tsx` reads the connection via `requireConnection<C>(id, tech)` from `src/lib/connections/server.ts` (404s if missing) and renders `<WorkspaceShell>` with a tech-specific sidebar.
  - Each section (containers, topics, tables…) is its own page.
  - Detail pages use shadcn `Tabs` (Data / Structure / Indexes / Logs / Messages / etc.).

## Connection store

`src/lib/connections/store.ts` is the single source of truth. Keyed by random id, segregated by `tech`. Use `redactConfig` / `publicView` before returning over the API — passwords never leave the server.

## API routes

All under `src/app/api/`. They follow the convention:
- `POST /api/<tech>/test` — probe connection, optionally save
- `GET /api/<tech>/[id]/...` — read operations (list containers, list topics, read table data)
- `POST /api/<tech>/[id]/.../action` — actions (start container, produce message, run query)
- `DELETE /api/<tech>/[id]/...` — destructive ops (remove container, delete topic)

Always wrap thrown errors with `formatError(err)` from `src/lib/errors.ts` — raw `Error.message` is often empty for `AggregateError` / `ECONNREFUSED`.

## Conventions to follow

- Server pages do `await params` then call `requireConnection`. Client components live in sibling `*-client.tsx` files; the page just hands over `connectionId` and route params.
- Workspace pages render through `<WorkspacePage title description actions>` for consistent chrome.
- Dialogs use shadcn `Dialog` with **imperative open state**, not `DialogClose asChild` — base-ui's `DialogClose` does not accept `asChild`.
- Buttons cannot wrap a `Link` via `asChild` either. To make a link look like a button, style the `Link` directly.
- Add new shadcn components via `npx shadcn@latest add <component> --yes`.
- For native server packages, register them in `next.config.ts` `serverExternalPackages` (already lists `dockerode`, `ssh2`, `kafkajs`, `pg`). Turbopack will refuse to bundle `ssh2`'s native crypto otherwise.

## Adding a new technology

1. Add a `TechId` literal in `src/lib/connections/types.ts` and a config interface.
2. Add a catalog entry in `src/lib/tech-catalog.ts` (icon, gradient, tagline).
3. Drop a driver helper in `src/lib/connections/<tech>.ts` (probe + per-object operations).
4. Add API routes under `src/app/api/<tech>/` (`test`, `[id]/...`).
5. Build the landing page at `src/app/<tech>/page.tsx` + `<tech>-client.tsx` (form + `<ConnectionsList>`).
6. Build the workspace at `src/app/<tech>/[connectionId>/`:
   - `layout.tsx` with `<WorkspaceShell>` and a sidebar of `<SidebarLink>`s (or a custom tree, like the Postgres one).
   - One page per object kind, optionally with a `[id]` detail subpage.

## Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # eslint (react-hooks/set-state-in-effect is intentionally off)
```

For real services to point Baklava at, see the `docker run` snippets in `README.md`.
