# Qdrant Vector Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Qdrant as a first-class vector-database tech module — installable via the driver flow, with a workspace to inspect collections, browse points, run similarity search, and create/delete collections and points.

**Architecture:** A standard tech module (`src/techs/qdrant/{meta,index}.ts`) registered in both registries; a server-only driver (`src/lib/connections/qdrant.ts`) that lazy-imports `@qdrant/js-client-rest` (optional dependency); REST routes under `src/app/api/qdrant/[id]/...`; a workspace under `src/app/qdrant/[connectionId]/...` with a Collections list and a per-collection detail using shadcn `Tabs` (Points / Search / Config).

**Tech Stack:** Next.js 16 App Router (Node runtime), TypeScript, `@qdrant/js-client-rest`, shadcn/base-ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-qdrant-vector-db-design.md`

---

## Conventions (read before coding)

- A "tech" is a module: `meta.ts` (client-safe — NO driver import) + `index.ts` (server — spreads meta + adds `driver`). Registered once in `src/techs/registry.ts` (full) and `src/techs/meta-registry.ts` (meta). See `src/techs/postgres/` and `src/techs/mongo/`.
- Drivers lazy-import their npm package behind a `get<Pkg>()` guard throwing `DriverNotInstalledError` (see `src/lib/connections/postgres.ts`). The package goes in `optionalDependencies`.
- `TechId` is a hand-maintained union; the registry is typed `Record<TechId, …>`, so **`tsc` fails until the module is registered** — add the `TechId` entry and register the module in the same task (Task 3).
- Routes: `export const runtime = "nodejs";`, wrap errors with `formatError` (and `errorResponse` for non-test routes). Test routes return `{ ok, probe|error }` at status 200.
- Server pages: `await params`, `requireConnection<C>(id, tech)`, render through `<WorkspacePage>`; client logic in `*-client.tsx` siblings; abort in-flight fetches on unmount.
- base-ui: no `asChild`; dialogs use imperative `[open,setOpen]`; `AlertDialog` for destructive confirms.
- Run `npm test` + `npm run typecheck` after each task; commit per task. Branch: `feat/qdrant`.

## Qdrant client API used (from `@qdrant/js-client-rest`)

- `new QdrantClient({ url, apiKey? })`
- `getCollections()` → `{ collections: [{ name }] }`
- `getCollection(name)` → `{ status, points_count, config: { params: { vectors } }, payload_schema }`. `vectors` is `{ size, distance }` (single unnamed) OR `{ [name]: { size, distance } }` (named vectors).
- `scroll(name, { limit, offset?, filter?, with_payload: true, with_vector })` → `{ points: [{ id, payload, vector? }], next_page_offset }`
- `search(name, { vector, limit, filter?, with_payload: true })` where `vector` is `number[]` (unnamed) or `{ name, vector: number[] }` (named) → `[{ id, score, payload }]`
- `retrieve(name, { ids: [id], with_vector: true })` → `[{ id, vector, payload }]`
- `createCollection(name, { vectors: { size, distance } })`
- `deleteCollection(name)`
- `delete(name, { points: ids })`

---

## Phase 1 — Module wiring (tile shows + installable)

### Task 1: Config type + Vector category

**Files:**
- Modify: `src/lib/connections/types.ts`
- Modify: `src/lib/tech-catalog.ts`
- Test: `src/lib/tech-catalog.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `src/lib/tech-catalog.test.ts`:

```ts
import { TECH_CATEGORIES } from "./tech-catalog";
describe("Vector category", () => {
  it("is a known category", () => {
    expect(TECH_CATEGORIES).toContain("Vector");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/tech-catalog.test.ts` → FAIL (no "Vector").

- [ ] **Step 3: Add the config + category.**

In `src/lib/connections/types.ts`, add the interface (do NOT touch the `TechId` union yet — that lands in Task 3 with the module, so the registry stays exhaustive):

```ts
export interface QdrantConfig {
  /** Base URL, e.g. http://localhost:6333 or a Qdrant Cloud URL. */
  url: string;
  /** Optional API key (Qdrant Cloud). Stored as a secret. */
  apiKey?: string;
}
```

In `src/lib/tech-catalog.ts`, add `"Vector"` to both `TechCategory` and the `TECH_CATEGORIES` array (place it after `"Database"`):

```ts
export type TechCategory =
  | "Runtime" | "Database" | "Vector" | "Streaming"
  | "Orchestration" | "Cache" | "Storage" | "Testing";

export const TECH_CATEGORIES = [
  "All", "Runtime", "Database", "Vector", "Streaming",
  "Orchestration", "Cache", "Storage", "Testing",
] as const;
```

- [ ] **Step 4: Run** `npx vitest run src/lib/tech-catalog.test.ts && npm run typecheck` → PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/types.ts src/lib/tech-catalog.ts src/lib/tech-catalog.test.ts
git commit -m "feat(qdrant): add QdrantConfig type and Vector category"
```

---

### Task 2: Driver — client bootstrap, probe, listCollections

**Files:**
- Create: `src/lib/connections/qdrant.ts`
- Test: `src/lib/connections/qdrant.test.ts`

- [ ] **Step 1: Write the failing test** (mock the client):

```ts
// src/lib/connections/qdrant.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const client = {
  getCollections: vi.fn(),
  getCollection: vi.fn(),
};
vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: vi.fn(() => client),
}));

import { probeQdrant, listCollections } from "./qdrant";

const cfg = { url: "http://localhost:6333" };

beforeEach(() => {
  client.getCollections.mockReset();
  client.getCollection.mockReset();
});

describe("listCollections", () => {
  it("maps each collection's config to a summary", async () => {
    client.getCollections.mockResolvedValue({ collections: [{ name: "docs" }] });
    client.getCollection.mockResolvedValue({
      status: "green",
      points_count: 42,
      config: { params: { vectors: { size: 1536, distance: "Cosine" } } },
    });
    const out = await listCollections(cfg);
    expect(out).toEqual([
      { name: "docs", status: "green", pointsCount: 42, vectorSize: 1536, distance: "Cosine", namedVectors: [] },
    ]);
  });
});

describe("probeQdrant", () => {
  it("returns the collection count", async () => {
    client.getCollections.mockResolvedValue({ collections: [{ name: "a" }, { name: "b" }] });
    expect(await probeQdrant(cfg)).toEqual({ collectionCount: 2 });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/connections/qdrant.test.ts` → FAIL (no module).

- [ ] **Step 3: Write the driver bootstrap + these two functions.**

```ts
// src/lib/connections/qdrant.ts
import "server-only";
import type { QdrantClient } from "@qdrant/js-client-rest"; // type-only — erased
import type { QdrantConfig } from "./types";
import { DriverNotInstalledError } from "@/techs/contract";

let mod: typeof import("@qdrant/js-client-rest") | null = null;
async function getQdrant(): Promise<typeof import("@qdrant/js-client-rest")> {
  try {
    return (mod ??= await import("@qdrant/js-client-rest"));
  } catch {
    throw new DriverNotInstalledError("qdrant", "@qdrant/js-client-rest");
  }
}

async function withClient<T>(cfg: QdrantConfig, fn: (c: QdrantClient) => Promise<T>): Promise<T> {
  const { QdrantClient } = await getQdrant();
  const client = new QdrantClient({ url: cfg.url, apiKey: cfg.apiKey || undefined });
  return fn(client);
}

export interface CollectionSummary {
  name: string;
  status: string;
  pointsCount: number;
  vectorSize: number | null;
  distance: string | null;
  namedVectors: string[];
}

/** Pull size/distance/namedVectors out of a getCollection() vectors config,
 *  which is either { size, distance } or { [name]: { size, distance } }. */
function vectorParams(vectors: unknown): { size: number | null; distance: string | null; named: string[] } {
  if (vectors && typeof vectors === "object") {
    const v = vectors as Record<string, unknown>;
    if (typeof v.size === "number") {
      return { size: v.size as number, distance: (v.distance as string) ?? null, named: [] };
    }
    const names = Object.keys(v);
    if (names.length) {
      const first = v[names[0]] as { size?: number; distance?: string };
      return { size: first?.size ?? null, distance: first?.distance ?? null, named: names };
    }
  }
  return { size: null, distance: null, named: [] };
}

export async function listCollections(cfg: QdrantConfig): Promise<CollectionSummary[]> {
  return withClient(cfg, async (c) => {
    const { collections } = await c.getCollections();
    return Promise.all(
      collections.map(async ({ name }) => {
        const info = await c.getCollection(name);
        const { size, distance, named } = vectorParams(info.config?.params?.vectors);
        return {
          name,
          status: String(info.status ?? "unknown"),
          pointsCount: info.points_count ?? 0,
          vectorSize: size,
          distance,
          namedVectors: named,
        };
      }),
    );
  });
}

export async function probeQdrant(cfg: QdrantConfig): Promise<{ collectionCount: number }> {
  return withClient(cfg, async (c) => {
    const { collections } = await c.getCollections();
    return { collectionCount: collections.length };
  });
}
```

- [ ] **Step 4: Run** `npx vitest run src/lib/connections/qdrant.test.ts && npm run typecheck` → PASS + clean.

> Note: `@qdrant/js-client-rest` is not installed yet, so the type-only import resolves via... it does NOT — install it now as part of this task so the type import + tests resolve: `npm install @qdrant/js-client-rest`. (Task 3 moves it to `optionalDependencies`; keep it installed.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/qdrant.ts src/lib/connections/qdrant.test.ts package.json package-lock.json
git commit -m "feat(qdrant): driver bootstrap, probe, listCollections (lazy client)"
```

---

### Task 3: Register the module (tile shows + installable)

**Files:**
- Modify: `src/lib/connections/types.ts` (TechId)
- Create: `src/techs/qdrant/meta.ts`, `src/techs/qdrant/index.ts`, `src/techs/qdrant/index.test.ts`
- Modify: `src/techs/registry.ts`, `src/techs/meta-registry.ts`, `package.json`
- Add: `public/icons/qdrant.svg`

- [ ] **Step 1:** Add `| "qdrant"` to the `TechId` union in `src/lib/connections/types.ts`.

- [ ] **Step 2: Write the module test:**

```ts
// src/techs/qdrant/index.test.ts
import { describe, it, expect } from "vitest";
import { qdrant } from "./index";
describe("qdrant module", () => {
  it("declares id, optionalDeps, category", () => {
    expect(qdrant.id).toBe("qdrant");
    expect(qdrant.optionalDeps).toEqual(["@qdrant/js-client-rest"]);
    expect(qdrant.serverPackages).toBeUndefined();
    expect(qdrant.catalog.category).toBe("Vector");
    expect(qdrant.capabilities?.vectorSearch).toBe(true);
  });
  it("summarises the URL host, safely", () => {
    const r = { id: "x", tech: "qdrant" as const, name: "n", status: "ok" as const, createdAt: 0, config: { url: "http://localhost:6333" } };
    expect(qdrant.summary(r)).toBe("localhost:6333");
    expect(qdrant.summary({ ...r, config: { url: "not a url" } })).toBe("not a url");
  });
});
```

- [ ] **Step 3: Run** `npx vitest run src/techs/qdrant/index.test.ts` → FAIL.

- [ ] **Step 4: Write `meta.ts`:**

```ts
// src/techs/qdrant/meta.ts
import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import type { QdrantConfig, ConnectionRecord } from "@/lib/connections/types";

const schema = z.object({ url: z.string(), apiKey: z.string().optional() });

export const qdrantMeta: TechModuleMeta<QdrantConfig> = {
  id: "qdrant",
  catalog: {
    id: "qdrant",
    name: "Qdrant",
    tagline: "Vector database",
    description: "Browse collections and points, run similarity search, and manage vectors.",
    category: "Vector",
    color: "from-rose-400 to-pink-600",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<QdrantConfig>, secretKeys: ["apiKey"] },
  summary: (r: ConnectionRecord) => {
    const url = (r.config as QdrantConfig).url ?? "";
    try { return new URL(url).host; } catch { return url; }
  },
  firstPage: "collections",
  optionalDeps: ["@qdrant/js-client-rest"],
  capabilities: { browse: true, query: true, objectExplorer: true, vectorSearch: true, health: true },
};
```

- [ ] **Step 5: Write `index.ts`:**

```ts
// src/techs/qdrant/index.ts
// SERVER ONLY — imports driver code. Client code must use ./meta or @/techs/meta-registry.
import type { TechModule } from "@/techs/contract";
import type { QdrantConfig } from "@/lib/connections/types";
import { probeQdrant } from "@/lib/connections/qdrant";
import { qdrantBody } from "@/lib/connections/health";
import { qdrantMeta } from "./meta";

export const qdrant: TechModule<QdrantConfig> = {
  ...qdrantMeta,
  driver: { probe: (c) => probeQdrant(c), health: qdrantBody },
};
```

> `qdrantBody` is added to `health.ts` in Task 12. To keep this task green, EITHER do Task 12 first, OR temporarily set `driver: { probe: (c) => probeQdrant(c) }` (no health) here and add `health` in Task 12. Recommended: omit `health` here; add it in Task 12.

- [ ] **Step 6: Register** in `src/techs/registry.ts` (import `qdrant`, add to `TECH_MODULES` record + `TECH_MODULE_LIST` — place after `s3`) and `src/techs/meta-registry.ts` (import `qdrantMeta`, add to `TECH_META` + `TECH_META_LIST`). Update the registry test's `TECH_IDS`/order arrays in `src/techs/registry.test.ts` and `src/techs/meta-registry.test.ts` to include `"qdrant"`.

- [ ] **Step 7: Move dep to optional.** In `package.json`, move `@qdrant/js-client-rest` from `dependencies` to `optionalDependencies`.

- [ ] **Step 8: Add the icon.** Save the Qdrant logo SVG to `public/icons/qdrant.svg` (brand mark; a simple monochrome SVG is fine — icons render with `dark:invert`). If unavailable, use a generic vector/database glyph placeholder so the tile renders.

- [ ] **Step 9: Run** `npm test && npm run typecheck && npm run build` → all pass; the Qdrant tile appears under the Vector category.

- [ ] **Step 10: Commit**

```bash
git add src/lib/connections/types.ts src/techs/qdrant/ src/techs/registry.ts src/techs/registry.test.ts src/techs/meta-registry.ts src/techs/meta-registry.test.ts package.json public/icons/qdrant.svg
git commit -m "feat(qdrant): register tech module (Vector category) + brand icon"
```

---

## Phase 2 — Driver operations

### Task 4: getCollection, scrollPoints

**Files:** Modify `src/lib/connections/qdrant.ts`; extend `qdrant.test.ts`.

- [ ] **Step 1: Tests** (append):

```ts
describe("getCollection", () => {
  it("returns config + stats", async () => {
    client.getCollection.mockResolvedValue({
      status: "green", points_count: 10,
      config: { params: { vectors: { size: 4, distance: "Dot" } } },
      payload_schema: { title: { data_type: "keyword" } },
    });
    const out = await getCollection(cfg, "docs");
    expect(out.pointsCount).toBe(10);
    expect(out.vectors).toEqual({ size: 4, distance: "Dot", named: [] });
    expect(out.payloadSchema).toEqual({ title: { data_type: "keyword" } });
  });
});

describe("scrollPoints", () => {
  it("returns points + nextOffset", async () => {
    client.scroll = vi.fn().mockResolvedValue({
      points: [{ id: 1, payload: { t: "a" }, vector: [0.1, 0.2] }],
      next_page_offset: 2,
    });
    const out = await scrollPoints(cfg, "docs", { limit: 1, withVector: true });
    expect(out.points[0]).toEqual({ id: 1, payload: { t: "a" }, vector: [0.1, 0.2] });
    expect(out.nextOffset).toBe(2);
    expect(client.scroll).toHaveBeenCalledWith("docs", expect.objectContaining({ limit: 1, with_payload: true, with_vector: true }));
  });
});
```

Add `getCollection`, `scrollPoints` to the mock `client` object at the top (`getCollection` already there; add `scroll`).

- [ ] **Step 2: Run** the test → FAIL.

- [ ] **Step 3: Implement** in `qdrant.ts`:

```ts
export interface CollectionDetail {
  status: string;
  pointsCount: number;
  vectors: { size: number | null; distance: string | null; named: string[] };
  payloadSchema: Record<string, unknown>;
}

export async function getCollection(cfg: QdrantConfig, name: string): Promise<CollectionDetail> {
  return withClient(cfg, async (c) => {
    const info = await c.getCollection(name);
    return {
      status: String(info.status ?? "unknown"),
      pointsCount: info.points_count ?? 0,
      vectors: vectorParams(info.config?.params?.vectors),
      payloadSchema: (info.payload_schema as Record<string, unknown>) ?? {},
    };
  });
}

export interface QdrantPoint { id: string | number; payload: Record<string, unknown> | null; vector?: number[] | Record<string, number[]> }

export async function scrollPoints(
  cfg: QdrantConfig,
  name: string,
  opts: { limit: number; offset?: string | number; filter?: unknown; withVector?: boolean },
): Promise<{ points: QdrantPoint[]; nextOffset: string | number | null }> {
  return withClient(cfg, async (c) => {
    const res = await c.scroll(name, {
      limit: opts.limit,
      offset: opts.offset,
      filter: opts.filter as never,
      with_payload: true,
      with_vector: opts.withVector ?? false,
    });
    return {
      points: (res.points ?? []) as QdrantPoint[],
      nextOffset: (res.next_page_offset as string | number | null) ?? null,
    };
  });
}
```

- [ ] **Step 4: Run** test + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(qdrant): getCollection + scrollPoints`.

---

### Task 5: searchPoints (vector + by-point-id), createCollection, deleteCollection, deletePoints

**Files:** Modify `src/lib/connections/qdrant.ts`; extend `qdrant.test.ts`.

- [ ] **Step 1: Tests** (append; add `search`, `retrieve`, `createCollection`, `deleteCollection`, `delete` to the mock client):

```ts
describe("searchPoints", () => {
  it("searches by a raw vector", async () => {
    client.search = vi.fn().mockResolvedValue([{ id: 1, score: 0.9, payload: { t: "a" } }]);
    const out = await searchPoints(cfg, "docs", { vector: [0.1, 0.2], limit: 5 });
    expect(out).toEqual([{ id: 1, score: 0.9, payload: { t: "a" } }]);
    expect(client.search).toHaveBeenCalledWith("docs", expect.objectContaining({ vector: [0.1, 0.2], limit: 5, with_payload: true }));
  });
  it("by pointId: retrieves the point's vector then searches", async () => {
    client.retrieve = vi.fn().mockResolvedValue([{ id: 7, vector: [1, 2, 3] }]);
    client.search = vi.fn().mockResolvedValue([{ id: 8, score: 0.8, payload: {} }]);
    const out = await searchPoints(cfg, "docs", { pointId: 7, limit: 3 });
    expect(client.retrieve).toHaveBeenCalledWith("docs", expect.objectContaining({ ids: [7], with_vector: true }));
    expect(client.search).toHaveBeenCalledWith("docs", expect.objectContaining({ vector: [1, 2, 3], limit: 3 }));
    expect(out[0].id).toBe(8);
  });
});

describe("mutations", () => {
  it("createCollection passes size + distance", async () => {
    client.createCollection = vi.fn().mockResolvedValue(true);
    await createCollection(cfg, "new", { size: 128, distance: "Cosine" });
    expect(client.createCollection).toHaveBeenCalledWith("new", { vectors: { size: 128, distance: "Cosine" } });
  });
  it("deleteCollection + deletePoints delegate", async () => {
    client.deleteCollection = vi.fn().mockResolvedValue(true);
    client.delete = vi.fn().mockResolvedValue(true);
    await deleteCollection(cfg, "new");
    await deletePoints(cfg, "docs", [1, 2]);
    expect(client.deleteCollection).toHaveBeenCalledWith("new");
    expect(client.delete).toHaveBeenCalledWith("docs", { points: [1, 2] });
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement:**

```ts
export interface SearchHit { id: string | number; score: number; payload: Record<string, unknown> | null }

export async function searchPoints(
  cfg: QdrantConfig,
  name: string,
  opts: { vector?: number[]; pointId?: string | number; vectorName?: string; limit: number; filter?: unknown },
): Promise<SearchHit[]> {
  return withClient(cfg, async (c) => {
    let vector = opts.vector;
    if (vector === undefined && opts.pointId !== undefined) {
      const got = await c.retrieve(name, { ids: [opts.pointId], with_vector: true });
      const v = got[0]?.vector;
      vector = (opts.vectorName && v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, number[]>)[opts.vectorName]
        : (v as number[])) ?? undefined;
      if (!vector) throw new Error(`Point ${opts.pointId} has no vector to search by`);
    }
    if (!vector) throw new Error("A query vector or pointId is required");
    const res = await c.search(name, {
      vector: opts.vectorName ? ({ name: opts.vectorName, vector } as never) : (vector as never),
      limit: opts.limit,
      filter: opts.filter as never,
      with_payload: true,
    });
    return (res ?? []).map((h) => ({ id: h.id, score: h.score, payload: (h.payload as Record<string, unknown>) ?? null }));
  });
}

export async function createCollection(cfg: QdrantConfig, name: string, opts: { size: number; distance: string }): Promise<void> {
  await withClient(cfg, (c) => c.createCollection(name, { vectors: { size: opts.size, distance: opts.distance as never } }));
}
export async function deleteCollection(cfg: QdrantConfig, name: string): Promise<void> {
  await withClient(cfg, (c) => c.deleteCollection(name));
}
export async function deletePoints(cfg: QdrantConfig, name: string, ids: (string | number)[]): Promise<void> {
  await withClient(cfg, (c) => c.delete(name, { points: ids }));
}
```

- [ ] **Step 4: Run** test + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(qdrant): search (vector/by-id), create/delete collection, delete points`.

---

## Phase 3 — API routes

### Task 6: `test` route

**Files:** Create `src/app/api/qdrant/test/route.ts`. (No unit test; covered by manual + integration.)

- [ ] **Step 1: Write** (mirror `src/app/api/mongo/test/route.ts`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { QdrantConfig } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { probeQdrant } from "@/lib/connections/qdrant";

export const runtime = "nodejs";

interface TestRequest { name: string; config: QdrantConfig; save?: boolean }

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try { body = (await req.json()) as TestRequest; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const url = body?.config?.url?.trim();
  if (!url) return NextResponse.json({ error: "URL is required" }, { status: 400 });
  body.config = { ...body.config, url };
  try {
    const probe = await probeQdrant(body.config);
    const record = body.save
      ? saveConnection({ tech: "qdrant", name: body.name || "Qdrant", config: body.config, status: "ok" })
      : null;
    return NextResponse.json({ ok: true, probe, connection: record ? publicView(record) : null });
  } catch (err) {
    return NextResponse.json({ ok: false, error: formatError(err) }, { status: 200 });
  }
}
```

- [ ] **Step 2:** `npm run typecheck` → clean.
- [ ] **Step 3: Commit** `feat(qdrant): POST /api/qdrant/test`.

---

### Task 7: collections list/create + detail/delete routes

**Files:** Create `src/app/api/qdrant/[id]/collections/route.ts` and `src/app/api/qdrant/[id]/collections/[name]/route.ts`.

- [ ] **Step 1:** `collections/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { listCollections, createCollection } from "@/lib/connections/qdrant";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  try { return NextResponse.json({ collections: await listCollections(record.config) }); }
  catch (err) { return errorResponse(err); }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  const body = (await req.json()) as { name?: string; size?: number; distance?: string };
  if (!body.name || !body.size || !body.distance) {
    return NextResponse.json({ error: "name, size and distance are required" }, { status: 400 });
  }
  try { await createCollection(record.config, body.name, { size: body.size, distance: body.distance }); return NextResponse.json({ ok: true }); }
  catch (err) { return errorResponse(err); }
}
```

- [ ] **Step 2:** `collections/[name]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { getCollection, deleteCollection } from "@/lib/connections/qdrant";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; name: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  try { return NextResponse.json(await getCollection(record.config, decodeURIComponent(name))); }
  catch (err) { return errorResponse(err); }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  try { await deleteCollection(record.config, decodeURIComponent(name)); return NextResponse.json({ ok: true }); }
  catch (err) { return errorResponse(err); }
}
```

- [ ] **Step 3:** `npm run typecheck` → clean. **Commit** `feat(qdrant): collections list/create/detail/delete routes`.

---

### Task 8: points (scroll/delete) + search routes

**Files:** Create `src/app/api/qdrant/[id]/collections/[name]/points/route.ts` and `.../search/route.ts`.

- [ ] **Step 1:** `points/route.ts` — GET scroll (filter via optional JSON in query is awkward; accept `POST`-less GET with `limit`/`offset`/`withVector`, and a separate body-bearing scroll is unnecessary for v1; filter on scroll is applied through the Search tab). DELETE removes points:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { scrollPoints, deletePoints } from "@/lib/connections/qdrant";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; name: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 25), 100);
  const offsetRaw = sp.get("offset");
  const withVector = sp.get("withVector") === "1";
  try {
    const res = await scrollPoints(record.config, decodeURIComponent(name), {
      limit, offset: offsetRaw ?? undefined, withVector,
    });
    return NextResponse.json(res);
  } catch (err) { return errorResponse(err); }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  const body = (await req.json()) as { ids?: (string | number)[] };
  if (!body.ids?.length) return NextResponse.json({ error: "ids are required" }, { status: 400 });
  try { await deletePoints(record.config, decodeURIComponent(name), body.ids); return NextResponse.json({ ok: true }); }
  catch (err) { return errorResponse(err); }
}
```

- [ ] **Step 2:** `search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { searchPoints } from "@/lib/connections/qdrant";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; name: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id, name } = await params;
  const record = requireConnection<QdrantConfig>(id, "qdrant");
  const body = (await req.json()) as { vector?: number[]; pointId?: string | number; vectorName?: string; limit?: number; filter?: unknown };
  try {
    const hits = await searchPoints(record.config, decodeURIComponent(name), {
      vector: body.vector, pointId: body.pointId, vectorName: body.vectorName,
      limit: Math.min(body.limit ?? 10, 100), filter: body.filter,
    });
    return NextResponse.json({ hits });
  } catch (err) { return errorResponse(err); }
}
```

- [ ] **Step 3:** `npm run typecheck` → clean. **Commit** `feat(qdrant): points scroll/delete + search routes`.

---

## Phase 4 — Workspace UI

### Task 9: Connection form + register in ConnectionSheet/first-page

**Files:** Create `src/app/qdrant/qdrant-form.tsx`. Modify wherever forms are wired into `ConnectionSheet` (grep `MongoForm` to find the switch) and `FIRST_PAGE` source (now `m.firstPage` via the module — already set to `"collections"`, no edit needed). Add `qdrant` to `FIRST_PAGE` consumers only if a hardcoded map exists (it doesn't — it derives from the registry).

- [ ] **Step 1:** Build `QdrantForm` modeled on `src/app/mongo/mongo-form.tsx`: fields `name`, `url` (default `http://localhost:6333`), `apiKey` (optional, password input, secret — omit when editing+blank like Mongo's URI). `test(save)` posts to `/api/qdrant/test`. On `save` success calls `onSaved?.()`. Props `{ onSaved?, initial? }`.
- [ ] **Step 2:** Wire `QdrantForm` into the connection sheet: `grep -rn "MongoForm" src/components` to find the per-tech form switch; add a `qdrant` case rendering `<QdrantForm>`.
- [ ] **Step 3:** `npm run build` → the Qdrant tile opens the sheet → form renders; test against a local Qdrant (`docker run -p 6333:6333 qdrant/qdrant`). **Commit** `feat(qdrant): connection form wired into the sheet`.

---

### Task 10: Workspace layout + Collections list

**Files:** Create `src/app/qdrant/[connectionId]/layout.tsx`, `qdrant-sidebar.tsx`, `collections/page.tsx`, `collections/collections-client.tsx`, and the workspace root `page.tsx` (redirect to `collections`).

- [ ] **Step 1: `layout.tsx`** (mirror `src/app/mongo/[connectionId]/layout.tsx`): `requireConnection<QdrantConfig>(connectionId, "qdrant")`, best-effort `probeQdrant(record.config).catch(() => null)` for the subtitle (`N collections` / `unreachable`), `<WorkspaceShell tech connectionName connectionId subtitle sidebar={<QdrantSidebar connectionId/>}>`.
- [ ] **Step 2: workspace root `page.tsx`** — `redirect(`/qdrant/${connectionId}/collections`)` (use `next/navigation` `redirect`; `await params` first).
- [ ] **Step 3: `qdrant-sidebar.tsx`** (client) — fetch `/api/qdrant/${id}/collections`, render a `<SidebarLink>` per collection to `/qdrant/${id}/collections/${encodeURIComponent(name)}` (see how `mongo-sidebar.tsx` lists items; a flat list is fine — no tree needed), plus a "New collection" button opening the create dialog (Task 11 dialog can live here or on the collections page; put it on the collections page).
- [ ] **Step 4: `collections/page.tsx`** (server) — `requireConnection`, `listCollections(record.config)` with the `.then/.catch → {ok}` pattern from `databases/page.tsx`, render `<WorkspacePage title="Collections" …>` wrapping `<CollectionsClient connectionId initial={result} />`.
- [ ] **Step 5: `collections/collections-client.tsx`** (client) — render collection cards (name, points, `vectorSize`d/`distance`, status badge); each links to the detail page. Include a **New collection** button → create dialog (POST `/api/qdrant/[id]/collections`, then `router.refresh()`), and a per-card **delete** via `AlertDialog` (DELETE `/api/qdrant/[id]/collections/[name]`, then refresh). Abort fetches on unmount.
- [ ] **Step 6:** `npm run build` + manual: collections list renders, create + delete work. **Commit** `feat(qdrant): workspace layout, sidebar, collections list + create/delete`.

---

### Task 11: Collection detail — Points / Search / Config tabs

**Files:** Create `src/app/qdrant/[connectionId]/collections/[name]/page.tsx` and `collection-detail-client.tsx`.

- [ ] **Step 1: `page.tsx`** (server) — `requireConnection`, `getCollection(record.config, name)` (`.then/.catch`), pass `connectionId`, `name`, and the detail to `<CollectionDetailClient>`. Wrap in `<WorkspacePage title={name} …>`.
- [ ] **Step 2: `collection-detail-client.tsx`** (client) — shadcn `Tabs` with three tabs:
  - **Points**: on mount + on "load more", GET `/api/qdrant/${id}/collections/${name}/points?limit=25&offset=${nextOffset ?? ""}&withVector=0`; render a table of `id` + payload (JSON, `<pre>` truncated/expandable) + a "show vector" toggle that refetches that page with `withVector=1` and renders dimension count + first-N values. Row checkboxes → **Delete selected** (`AlertDialog` → DELETE with `{ ids }` → refetch). "Load more" uses `nextOffset`.
  - **Search**: a mode toggle — "By point id" (input an id) or "By vector" (JSON-array textarea); a `limit` input; optional payload-filter JSON textarea; **Search** → POST `/api/qdrant/${id}/collections/${name}/search` with `{ pointId }` or `{ vector }` (+ `filter`, `limit`). Render hits: `score` (fixed 4dp) + `id` + payload. Parse the vector/filter textareas with `JSON.parse` in a try/catch and show an inline error on bad JSON.
  - **Config**: render `vectors` (size, distance, named-vector list if `named.length`), `payloadSchema` (key → data_type), `status`, `pointsCount`.
  - If `vectors.named.length`, show a vector-name `<select>` shared by the Points "show vector" and Search.
  - Store `EventSource`-free fetches with an `AbortController` ref; abort on unmount.
- [ ] **Step 3:** `npm run build` + manual against local Qdrant with a seeded collection. **Commit** `feat(qdrant): collection detail with Points/Search/Config tabs`.

---

## Phase 5 — Health, integration, docs

### Task 12: Health probe

**Files:** Modify `src/lib/connections/health.ts`; set `health` on the module in `src/techs/qdrant/index.ts`.

- [ ] **Step 1:** In `health.ts`, add and `export` a `qdrantBody(conn)` returning a `ProbeBody` — call `probeQdrant(conn.config as QdrantConfig)` and summarise `${collectionCount} collections` with a metric. Mirror the shape of the existing `*Body` functions (e.g. `redisBody`). (Dispatch is already registry-driven via `driver.health`, so no switch edit.)
- [ ] **Step 2:** In `src/techs/qdrant/index.ts`, add `health: qdrantBody` to `driver` (import from `@/lib/connections/health`).
- [ ] **Step 3:** `npm test && npm run typecheck && npm run build` → pass. **Commit** `feat(qdrant): dashboard health probe`.

---

### Task 13: Integration test (gated)

**Files:** Create `src/lib/connections/qdrant.integration.test.ts`.

- [ ] **Step 1:** Mirror the gating of the other `*.integration.test.ts` (run only when `BAKLAVA_INTEGRATION=1` and a Qdrant is reachable at `QDRANT_URL ?? http://localhost:6333`). Flow: `createCollection("baklava_it", { size: 4, distance: "Cosine" })` → upsert a few points via the raw client (or a tiny `upsert` helper added to the driver if needed) → `scrollPoints` returns them → `searchPoints({ pointId })` returns ranked hits → `deletePoints` → `deleteCollection`. Skip cleanly if unreachable.
- [ ] **Step 2:** `BAKLAVA_INTEGRATION=1 npm run test:integration` with `docker run -p 6333:6333 qdrant/qdrant` running → passes; without the env it's skipped. **Commit** `test(qdrant): gated integration test`.

> If upserting points requires a driver function not yet present, add a minimal `upsertPoints(cfg, name, points)` to `qdrant.ts` (client `upsert(name, { points })`) with a unit test — keep it; it's also the natural seam for a future "add point" UI.

---

### Task 14: Docs

**Files:** Modify `README.md` (the `docker run` snippets section) and `AGENTS.md` if it enumerates techs.

- [ ] **Step 1:** Add a Qdrant `docker run -p 6333:6333 qdrant/qdrant` snippet to `README.md` alongside the other services. If `AGENTS.md` lists the tech count/categories, update it to include Qdrant / the Vector category.
- [ ] **Step 2: Commit** `docs(qdrant): add Qdrant to README services + notes`.

---

## Self-Review (completed during authoring)

- **Spec coverage:** module wiring + Vector category (Tasks 1, 3) ✓; lazy optional-dep driver (Task 2) ✓; all driver ops list/get/scroll/search(vector+byId)/create/delete (Tasks 2, 4, 5) ✓; routes test/collections/detail/points/search (Tasks 6–8) ✓; form (Task 9); workspace layout+collections list+create/delete (Task 10); Points/Search/Config tabs with vector preview, payload filter, by-point search, named-vector picker, destructive confirms (Task 11) ✓; health (Task 12) ✓; integration test (Task 13) ✓; safe URL summary (Task 3 test) ✓; docs (Task 14). Out-of-scope items (upsert UI beyond the integration seam, command-palette provider, snapshots) excluded ✓.
- **Placeholder scan:** no TBD/"similar to" — every code step has concrete content; pattern-following UI tasks reference a named existing file to mirror AND specify exact endpoints/props.
- **Type consistency:** `QdrantConfig`, `CollectionSummary`, `CollectionDetail`, `QdrantPoint`, `SearchHit`, and driver fn signatures (`listCollections`/`getCollection`/`scrollPoints`/`searchPoints`/`createCollection`/`deleteCollection`/`deletePoints`/`probeQdrant`) are consistent across driver, routes, and UI. Endpoints match between routes (Tasks 6–8) and clients (Tasks 9–11).
- **Ordering risk flagged:** `qdrant/index.ts` references `qdrantBody` (Task 12) — Task 3 omits `health` and Task 12 adds it, keeping every task green. Adding `"qdrant"` to `TechId` + registering happen together in Task 3 so `Record<TechId,…>` stays exhaustive.
