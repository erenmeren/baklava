# Qdrant Vector Database Integration — Design

**Date:** 2026-06-18
**Status:** Approved (design); ready for implementation planning
**Builds on:** the tech-module architecture (`docs/superpowers/specs/2026-06-16-tech-module-plugin-architecture-design.md`) and the in-app driver install flow.

## Problem / goal

Baklava integrates 11 backends but no vector database — the one category that has
become central to AI applications. Add **Qdrant** as the first vector-DB
integration, implemented as a standard tech module so it slots into the registry,
the home grid, and the install/uninstall driver flow with no special-casing.

The workspace gives the full management surface: inspect collections, browse
points, run **similarity search**, filter by payload, and create/delete
collections and points.

## Why Qdrant first

Clean REST API with a simple model (collections → points = id + vector + payload);
similarity search and payload filtering are first-class; trivial to self-host via
Docker for testing; the official `@qdrant/js-client-rest` is pure JS, so it fits
the lazy-import optional-dependency pattern with no `serverExternalPackages` entry.
(pgvector — a Postgres extension — and Weaviate/Chroma are possible follow-ups but
out of scope here.)

## Module wiring

- **`TechId`**: add `"qdrant"` to the union in `src/lib/connections/types.ts`.
- **Category**: add `"Vector"` to `TechCategory` and `TECH_CATEGORIES` in
  `src/lib/tech-catalog.ts` (cleaner than reusing `Database`).
- **Config**: `interface QdrantConfig { url: string; apiKey?: string }`. `url` is
  the base URL (e.g. `http://localhost:6333` or a Qdrant Cloud URL); `apiKey` is
  optional (Qdrant Cloud) and is a secret. `secretKeys: ["apiKey"]`.
- **Module**: `src/techs/qdrant/meta.ts` + `index.ts`:
  - `optionalDeps: ["@qdrant/js-client-rest"]`; **no `serverPackages`** (pure JS,
    bundles fine).
  - `capabilities: { browse: true, query: true, objectExplorer: true, vectorSearch: true, health: true }`.
  - `firstPage: "collections"`.
  - `summary: (r)` → host of the configured URL, parsed safely (try `new URL(cfg.url).host`, fall back to the raw `cfg.url` if it doesn't parse — never throw).
  - catalog entry: name "Qdrant", tagline "Vector database", category "Vector",
    a gradient `color`, `status: "available"`.
- **Registration**: one line each in `src/techs/registry.ts` (full module) and
  `src/techs/meta-registry.ts` (meta); add `@qdrant/js-client-rest` to
  `optionalDependencies` in `package.json`. The codegen for `serverExternalPackages`
  is unaffected (no native dep).
- **Driver install flow**: works automatically — a not-installed Qdrant tile shows
  the install modal listing `@qdrant/js-client-rest`; uninstall via the `⋯` menu.

## Driver

`src/lib/connections/qdrant.ts`, server-only, lazy-imports the client:

```ts
import type { QdrantClient } from "@qdrant/js-client-rest"; // type-only — erased
import { DriverNotInstalledError } from "@/techs/contract";

let mod: typeof import("@qdrant/js-client-rest") | null = null;
async function getQdrant() {
  try { return (mod ??= await import("@qdrant/js-client-rest")); }
  catch { throw new DriverNotInstalledError("qdrant", "@qdrant/js-client-rest"); }
}
async function withClient<T>(cfg: QdrantConfig, fn: (c: QdrantClient) => Promise<T>): Promise<T> {
  const { QdrantClient } = await getQdrant();
  const client = new QdrantClient({ url: cfg.url, apiKey: cfg.apiKey || undefined });
  return fn(client);
}
```

Exported operations:
- `probeQdrant(cfg)` → `{ version?, collectionCount }` (used by `test` + health).
- `listCollections(cfg)` → `[{ name, pointsCount, vectorsCount, status, vectorSize, distance, namedVectors }]` (per-collection summary from `getCollection`/`getCollections`).
- `getCollection(cfg, name)` → full config: vector params (size, distance; or a map
  of named vectors), payload schema/indexes, optimizer status, point count.
- `scrollPoints(cfg, name, { limit, offset?, filter?, withVector })` →
  `{ points: [{ id, payload, vector? }], nextOffset }` (Qdrant scroll API).
- `searchPoints(cfg, name, { vector?, pointId?, vectorName?, limit, filter? })` →
  `[{ id, score, payload }]`. If `pointId` is given, fetch that point's vector and
  search by it (the "find similar to this point" path); otherwise use `vector`.
- `createCollection(cfg, name, { size, distance })`.
- `deleteCollection(cfg, name)`.
- `deletePoints(cfg, name, ids)`.

Inputs (filter objects, vectors, ids) are passed as **structured params** to the
client — never string-interpolated.

## API routes

Under `src/app/api/qdrant/[id]/...`, all `runtime = "nodejs"`, errors via
`formatError` / `errorResponse` (so a missing driver → clear message / 503):

- `POST /api/qdrant/test` — probe, optionally save (mirrors other `test` routes).
- `GET  /collections` — list. `POST /collections` — create `{ name, size, distance }`.
- `GET  /collections/[name]` — detail/config. `DELETE /collections/[name]` — delete.
- `GET  /collections/[name]/points?limit&offset&withVector` (+ optional filter via
  POST body if needed) — scroll. `DELETE /collections/[name]/points` — delete `{ ids }`.
- `POST /collections/[name]/search` — `{ vector? | pointId?, vectorName?, limit, filter? }`.

## Workspace UI

`src/app/qdrant/[connectionId]/`:
- `layout.tsx` — `requireConnection<QdrantConfig>(id, "qdrant")` + `<WorkspaceShell>`
  + sidebar (Collections).
- **`collections/` (and workspace root → `collections`)** — list of collection
  cards/rows: name, point count, vector size, distance, status. A **New collection**
  dialog (`name`, `size`, `distance` select). Per-collection **delete** behind an
  `AlertDialog` confirm.
- **`collections/[name]/` detail** — shadcn `Tabs`:
  - **Points** — paginated scroll browser: `id`, payload (JSON, formatted), vector
    preview (**dimension count + truncated values, expandable** — never render a
    full high-dim array). A JSON **payload-filter** box (Qdrant filter DSL).
    Multi-select rows → **delete points** (confirm).
  - **Search** — similarity search. **Primary path: "find similar to this point"**
    (select a point → search by its id). Power-user path: paste a query vector
    (JSON array). Optional payload filter + `limit`. Results table with **score** +
    payload, ranked.
  - **Config** — vector params (size, distance; named-vector map if present),
    payload index schema, point count / status.
- `src/app/qdrant/qdrant-form.tsx` — URL + optional API-key fields; reused by
  `ConnectionSheet`. Client logic in `*-client.tsx` siblings per convention;
  abort in-flight fetches on unmount.

## Edge cases & safety

- **Named vectors**: Qdrant collections may define multiple named vectors. Detect
  from `getCollection`; when present, the Points/Search UI exposes a vector-name
  picker. The default single unnamed vector is the common path.
- **High-dimensional vectors**: never dump full arrays in tables; show dimension +
  a truncated preview, expandable on demand. `withVector` defaults to `false` on
  scroll for performance; fetched on demand.
- **Destructive ops** (delete collection, delete points) require an `AlertDialog`
  confirm; routes are `DELETE`.
- **Empty / unreachable**: list/detail handle zero collections and connection
  errors via `formatError` (surfaced in the UI, not thrown raw).
- **Driver absent**: the lazy guard throws `DriverNotInstalledError`; the tile shows
  "not installed" and the install modal offers `@qdrant/js-client-rest`.

## Testing

- **Driver unit tests** (mock `@qdrant/js-client-rest`): `listCollections`,
  `scrollPoints`, `searchPoints` (both `vector` and `pointId` paths),
  `createCollection`, `deleteCollection`, `deletePoints` — assert request shape and
  result mapping; confirm filters/vectors pass as structured params.
- **Module test**: `qdrant.id`, `optionalDeps`, `summary` output, `capabilities`.
- **Integration test** (`qdrant.integration.test.ts`, gated behind a running Qdrant
  via Docker, like the other `*.integration.test.ts`): create → upsert a few points
  → scroll → search → delete, end to end.
- Existing suite stays green; `npm run build` succeeds (no native dep added).

## Out of scope (future)

- Command-palette object provider for collections (defer — YAGNI for v1).
- Upsert/edit points from the UI (v1 is inspect + search + collection/point delete +
  collection create).
- Snapshots, aliases, cluster/sharding management.
- Other vector DBs (pgvector, Weaviate, Chroma) — separate efforts; the contract
  makes them additive.
