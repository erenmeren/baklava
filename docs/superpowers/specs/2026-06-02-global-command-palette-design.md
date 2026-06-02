# Global ⌘K Command Palette — Design

**Date:** 2026-06-02
**Status:** Approved for spec review

## Summary

Add a single, app-wide **⌘K command palette** to Baklava (the unified ops
console for 11 techs). Today there are per-tech palettes on four techs
(Postgres/MySQL/SQL Server/Kubernetes) and nothing global. This replaces those
four with **one palette mounted in the root layout**, available on the home grid
and every workspace, that lets a developer fuzzy-jump to:

1. **Any connection** (across all techs) → its workspace,
2. **Any section** of the connection they're currently in (Tables / Topics /
   Buckets / Pods / …),
3. **Objects** within the current connection — *for the four techs that already
   have object search* (folded in, no regression),
4. **Global actions** (new connection, go home, toggle theme).

Triggered by **⌘K / Ctrl+K** and a small discoverable **"⌘K" pill** in the top bar.

## Scope decisions (settled in brainstorming)

- **Depth:** connections + sections + actions for all 11 techs. Object search is
  carried over **only** for the 4 techs that already implement it — no new object
  providers for the other 7. Cross-connection object search is out of scope.
- **⌘K ownership:** the global palette owns ⌘K everywhere; the 4 per-tech palette
  hosts are removed and their object search is folded into the global palette
  (preserving today's reach — no regression).
- **Trigger:** ⌘K/Ctrl+K **and** a header pill.

## Architecture

### 1. `src/components/command-palette/global-command-palette.tsx` (`"use client"`)
Mounted once in `src/app/layout.tsx` (next to `ConnectionTabs`/`Toaster`), so it's
live on every route. Responsibilities:
- Owns the `keydown` handler for ⌘K/Ctrl+K (the only ⌘K owner in the app).
- Reads the connection list (see §5), the current route (`usePathname`), and
  builds the grouped entries below.
- Renders via the existing `@/components/ui/command.tsx` (`CommandDialog`,
  `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty`).
- On select: `router.push(target)` then close.

### 2. `src/lib/command-palette/sections.ts`
Static catalog of each tech's navigable sections, as data:
```ts
export interface TechSection { label: string; seg: string; icon: string } // icon = lucide name
export const TECH_SECTIONS: Record<TechId, TechSection[]>;
```
Populated from each tech's existing sidebar nav. Examples: `docker` →
[containers, images, networks, volumes, stacks]; `postgres` → [databases,
activity, locks, roles, extensions, diagnostics, replication]; `redis` → [keys,
cli, pubsub, streams, monitor, cluster, acl, info]; blob techs (`r2`/`minio`/`s3`)
→ [overview ("" seg), buckets]; etc. A section's target is
`/${tech}/${connectionId}/${seg}` (empty `seg` → the overview/root).

### 3. `src/lib/command-palette/recent.ts`
LRU of recently-opened connection IDs in `localStorage`
(`baklava:recent-connections`, cap ~8). Exports `recordVisit(id)`,
`getRecent(): string[]`. A `useRecordVisit(connectionId)` hook is fired from
`WorkspaceShell` (already wraps every workspace) so visits are tracked without
touching each tech.

### 4. `src/lib/command-palette/object-providers.ts`
The fold-in seam for the 4 existing palettes:
```ts
export interface PaletteObject { label: string; sublabel?: string; href: string; icon?: string }
export const OBJECT_PROVIDERS: Partial<
  Record<TechId, (connectionId: string, query: string) => Promise<PaletteObject[]>>
>;
```
Implemented for `postgres`, `mysql`, `sqlserver`, `kubernetes` by **relocating the
fetch logic out of the existing per-tech palette hosts** (e.g. Postgres' database
list from `/api/postgres/[id]/databases`). Each returns navigable objects
(database/table/pod/…) with their routes. Failures resolve to `[]`. The other 7
techs have no entry (group simply doesn't render).

### 5. Connection-list fetch — `src/lib/command-palette/use-connections.ts`
`ConnectionTabs` already fetches `/api/connections`. Extract a tiny shared
`useConnections()` hook (returns `{connections, fetched}`) and have both
`ConnectionTabs` and the palette consume it, avoiding a duplicate request. Returns
`publicView` records (no secrets) — the palette only needs id/tech/name/config-summary.

### 6. Header pill
A small `⌘K` button in `src/app/layout.tsx`'s top bar (near `ConnectionTabs` /
`ThemeToggle`) that dispatches the same open action (shared via a module-level
event or a context). Shows `⌘K` on mac, `Ctrl K` elsewhere (detect via
`navigator.platform` after mount to avoid SSR mismatch).

## Entries (grouped; cmdk does the fuzzy filtering)

1. **Connections** — all saved connections, **recent first** then alphabetical.
   Each item: tech icon + name + connection summary. Target:
   `/${tech}/${id}/${FIRST_PAGE[tech]}` (reuse `FIRST_PAGE` from
   `connection-tabs.tsx` — extract it to a shared module so both use it).
2. **Go to** — shown only when the route matches `/${tech}/${connectionId}/…`;
   lists `TECH_SECTIONS[tech]` for that connection.
3. **In this connection** — shown only when `OBJECT_PROVIDERS[tech]` exists;
   async, debounced (~150ms) on the palette query; results from the provider.
4. **Actions** — "New connection" (→ `/` and trigger the home Sheet),
   "Go to home", "Toggle theme" (reuse the existing theme toggle logic).

## Data flow

⌘K (or pill) → open `CommandDialog` → `useConnections()` supplies the connection
group instantly (already-fetched), `usePathname()` drives the "Go to" / "In this
connection" groups, the object provider fires lazily/debounced as the user types.
Selecting an item routes and closes. The recent-connection LRU is updated by
`WorkspaceShell` on mount, not by the palette.

## Error handling

- Object-provider rejections → `[]` (the group renders empty); the palette's
  navigation entries always work regardless of backend reachability.
- No connections yet → Connections group shows an empty hint + the "New
  connection" action is prominent.
- Client-only component, opened on interaction → no SSR/hydration hazard; the
  platform-specific key glyph is resolved post-mount.

## Reconciliation of existing per-tech palettes

Remove these hosts and their ⌘K handlers (their object-fetch moves to
`object-providers.ts`):
- `src/app/postgres/[connectionId]/command-palette-host.tsx` (+ its mount in
  `postgres/[connectionId]/layout.tsx`),
- the equivalent ⌘K palette mounts in `mysql`, `sqlserver`, and `kubernetes`
  layouts (`k8s-shell.tsx`).
- `src/components/postgres/command-palette.tsx` (and any mysql/sqlserver/k8s
  equivalents) — either deleted or reduced to the parts reused by the provider.

After this, exactly one component binds ⌘K.

## Testing

- **Unit (vitest):** `TECH_SECTIONS` completeness — every `status:"available"`
  tech in the catalog has a `TECH_SECTIONS` entry, and every `seg` is non-null;
  `recent.ts` LRU behavior (cap, dedupe, most-recent-first).
- **Live browser smoke:** ⌘K on the home grid → filter + Enter jumps to a
  connection workspace; ⌘K inside a workspace → "Go to" jumps to a section; for
  Postgres, the "In this connection" group still finds a database (fold-in
  works); the header pill opens the same palette; verify only one palette responds
  to ⌘K (no double-open on the 4 ex-palette techs).
- Gates: tsc, lint, vitest, build.

## Out of scope (v1)

- Cross-connection object search.
- New object providers for docker/kafka/redis/mongo/r2/minio/s3.
- Palette actions beyond the three listed; command "modes"; results ranking
  beyond recent-first + cmdk's fuzzy score.

## File inventory

**New:**
`src/components/command-palette/global-command-palette.tsx`,
`src/lib/command-palette/{sections.ts,recent.ts,object-providers.ts,use-connections.ts}`,
`src/lib/command-palette/sections.test.ts`, `src/lib/command-palette/recent.test.ts`,
a header-pill component (or inline in layout).

**Modified:**
`src/app/layout.tsx` (mount palette + pill),
`src/components/connection-tabs.tsx` (extract `FIRST_PAGE` + use `useConnections`),
`src/components/workspace/workspace-shell.tsx` (fire `useRecordVisit`),
`src/app/postgres/[connectionId]/layout.tsx`, `.../mysql/...`, `.../sqlserver/...`,
`src/app/kubernetes/[connectionId]/k8s-shell.tsx` (remove per-tech palette mounts),
and relocate the four palettes' fetch logic into `object-providers.ts`.
