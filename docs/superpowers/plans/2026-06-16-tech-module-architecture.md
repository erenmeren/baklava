# Tech Module Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each technology a single self-contained `TechModule` that core derives everything from via a registry, with drivers behind a lazy/optional dependency boundary that degrades gracefully when absent.

**Architecture:** A pure-type `TechModule` contract in core; a `registry.ts` that lists one module per `TechId`; core consumers (catalog, summaries, first-page, secret keys, health, command palette, `next.config` codegen) derive from the registry instead of hardcoding each tech. Drivers move to `optionalDependencies` and lazy-import behind a guard that throws `DriverNotInstalledError`. Registration and driver-relocation are decoupled so the de-scatter lands before any driver is touched.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Zod (already a dep), Vitest. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-tech-module-plugin-architecture-design.md`

---

## File Structure

**Created:**
- `src/techs/contract.ts` — the `TechModule` interface + `TechDriver`, `DriverNotInstalledError`, `BaseConfig` re-exports. Pure types + the one error class. No runtime tech deps.
- `src/techs/presence.ts` — `isDriverInstalled(pkg)` (cached `require.resolve` check) + `modulesInstalled(module)`.
- `src/techs/registry.ts` — imports every tech module, exports `TECH_MODULES` (`Record<TechId, TechModule>`), `TECH_MODULE_LIST`, `techById`, `requireTechModule`.
- `src/techs/<tech>/index.ts` — one per tech (11 total). Declares metadata + re-exports the existing driver (Phase 2); owns the relocated driver (Phase 4).
- `src/techs/server-packages.generated.ts` — codegen output consumed by `next.config.ts`.
- `scripts/gen-server-packages.ts` — ~30-line deterministic codegen.
- Test files alongside: `src/techs/contract.test.ts`, `src/techs/presence.test.ts`, `src/techs/registry.test.ts`, `scripts/gen-server-packages.test.ts`.

**Modified:**
- `src/lib/tech-catalog.ts` — `TECH_CATALOG` derived from registry + the standalone `loadtest` tool entry.
- `src/lib/connections/summaries.ts` — `connectionSummaries` derived from registry.
- `src/lib/connections/first-page.ts` — `FIRST_PAGE` derived from registry.
- `src/lib/connections/store.ts` — `SECRET_KEYS` derived from registry (union of module secret keys).
- `src/lib/connections/health.ts` — `probeFor` dispatches via registry.
- `src/lib/command-palette/object-providers.ts` — `OBJECT_PROVIDERS` derived from registry.
- `src/lib/errors.ts` — `formatError` recognizes `DriverNotInstalledError`.
- `next.config.ts` — `serverExternalPackages` from `server-packages.generated.ts`.
- `package.json` — drivers `dependencies → optionalDependencies`; add `prebuild`/`predev` codegen scripts.
- Per-tech driver files relocate into `src/techs/<tech>/driver.ts` (Phase 4).
- `AGENTS.md` — rewrite "Adding a new technology" (Phase 5).

---

## Decisions locked from the spec (read before coding)

1. **`TechId` stays a hand-maintained union** in `src/lib/connections/types.ts`. The registry is typed `Record<TechId, TechModule>` so `tsc` errors if a tech is missing — that is the completeness check. Do **not** derive `TechId` from the registry.
2. **`loadtest` is NOT a `TechModule`.** It is `kind: "tool"`, not in `TechId`, has no connection/driver. It stays a hand-written entry appended to the derived catalog.
3. **The contract standardizes cross-cutting concerns only** (catalog, config, secrets, summary, firstPage, optionalDeps, serverPackages, capabilities, health, commandObjects, `driver.probe`). It does **not** unify the full operation surface — `runQuery`, `listContainers`, etc. stay tech-specific exports from the module that routes import directly. The contract's `driver` only guarantees `probe`.
4. **`SECRET_KEYS` becomes the union of every module's `secretKeys`.** Redaction/merge stay key-name-based and tech-agnostic (today's behavior) — only the *source* of the key list moves into modules. Do not thread `tech` through `redactConfig`/`mergeConfig`.
5. **Phase 2 does not move driver code.** Each module re-exports its existing `src/lib/connections/<tech>.ts`. Phase 4 relocates and makes lazy, one tech per unit.
6. Run `npm test` and `npm run typecheck` after every phase. Commit per task.

---

## Phase 1 — Infrastructure (zero behavior change)

### Task 1: The `TechModule` contract + `DriverNotInstalledError`

**Files:**
- Create: `src/techs/contract.ts`
- Test: `src/techs/contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/techs/contract.test.ts
import { describe, it, expect } from "vitest";
import { DriverNotInstalledError } from "./contract";

describe("DriverNotInstalledError", () => {
  it("carries tech id and package name and a clear message", () => {
    const err = new DriverNotInstalledError("postgres", "pg");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DriverNotInstalledError");
    expect(err.tech).toBe("postgres");
    expect(err.pkg).toBe("pg");
    expect(err.message).toContain("postgres");
    expect(err.message).toContain("pg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/techs/contract.test.ts`
Expected: FAIL — cannot find module `./contract`.

- [ ] **Step 3: Write the contract + error**

```ts
// src/techs/contract.ts
import type { ZodType } from "zod";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";
import type { TechMeta } from "@/lib/tech-catalog";
import type { ObjectProvider } from "@/lib/command-palette/object-providers";

export type BaseConfig = Record<string, unknown>;

/** Thrown by a tech driver when its optional npm package is not installed. */
export class DriverNotInstalledError extends Error {
  constructor(
    public readonly tech: TechId,
    public readonly pkg: string,
  ) {
    super(`The "${tech}" driver requires the "${pkg}" package, which is not installed. Run: npm i ${pkg}`);
    this.name = "DriverNotInstalledError";
  }
}

/** The only operation the contract guarantees. Tech-specific operations live as
 *  additional exports from the module's driver file and are imported directly. */
export interface TechDriver<C extends BaseConfig> {
  /** Probe the connection. Throws on failure; resolves with tech-specific probe info. */
  probe(config: C): Promise<unknown>;
}

/** Dashboard health probe — wraps the existing per-tech `*Body` functions. */
export type HealthProbe = (conn: ConnectionRecord) => Promise<unknown>;

export interface TechCapabilities {
  browse?: boolean;
  query?: boolean;
  upload?: boolean;
  objectExplorer?: boolean;
  vectorSearch?: boolean;
  graphTraversal?: boolean;
  health?: boolean;
}

export interface TechModule<C extends BaseConfig = BaseConfig> {
  id: TechId;
  catalog: TechMeta;
  config: {
    schema: ZodType<C>;
    secretKeys: string[];
    defaults?: Partial<C>;
  };
  driver: TechDriver<C>;
  summary: (r: ConnectionRecord) => string;
  firstPage: string;
  optionalDeps: string[];
  serverPackages?: string[];
  health?: HealthProbe;
  commandObjects?: ObjectProvider;
  capabilities?: TechCapabilities;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/techs/contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/techs/contract.ts src/techs/contract.test.ts
git commit -m "feat(techs): add TechModule contract and DriverNotInstalledError"
```

---

### Task 2: Driver presence check

**Files:**
- Create: `src/techs/presence.ts`
- Test: `src/techs/presence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/techs/presence.test.ts
import { describe, it, expect } from "vitest";
import { isDriverInstalled } from "./presence";

describe("isDriverInstalled", () => {
  it("returns true for a package that exists", () => {
    expect(isDriverInstalled("zod")).toBe(true); // always installed
  });
  it("returns false for a package that does not exist", () => {
    expect(isDriverInstalled("totally-not-a-real-pkg-xyz")).toBe(false);
  });
  it("caches the result (second call cheap, same value)", () => {
    expect(isDriverInstalled("zod")).toBe(true);
    expect(isDriverInstalled("zod")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/techs/presence.test.ts`
Expected: FAIL — cannot find module `./presence`.

- [ ] **Step 3: Write the implementation**

```ts
// src/techs/presence.ts
import { createRequire } from "node:module";
import type { TechModule } from "./contract";

const require = createRequire(import.meta.url);
const cache = new Map<string, boolean>();

/** True if `pkg` can be resolved from this process. Cached per package. */
export function isDriverInstalled(pkg: string): boolean {
  const hit = cache.get(pkg);
  if (hit !== undefined) return hit;
  let installed = false;
  try {
    require.resolve(pkg);
    installed = true;
  } catch {
    installed = false;
  }
  cache.set(pkg, installed);
  return installed;
}

/** True only if every optional dependency the module declares is resolvable. */
export function modulesInstalled(module: TechModule): boolean {
  return module.optionalDeps.every(isDriverInstalled);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/techs/presence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/techs/presence.ts src/techs/presence.test.ts
git commit -m "feat(techs): add cached driver presence check"
```

---

## Phase 2 — Wrap every tech as a module (no code move) + register

> Each module declares metadata pulled verbatim from the existing scattered files and re-exports its current driver. **Do not change any driver code or any import elsewhere yet.**

### Task 3: The `postgres` module (worked example for all 11)

**Files:**
- Create: `src/techs/postgres/index.ts`
- Test: `src/techs/postgres/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/techs/postgres/index.test.ts
import { describe, it, expect } from "vitest";
import { postgres } from "./index";

describe("postgres module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(postgres.id).toBe("postgres");
    expect(postgres.optionalDeps).toEqual(["pg"]);
    expect(postgres.catalog.id).toBe("postgres");
    expect(postgres.serverPackages).toEqual(["pg"]);
  });
  it("summarises a connection record", () => {
    const summary = postgres.summary({
      id: "x", tech: "postgres", name: "n", status: "ok", createdAt: 0,
      config: { host: "h", port: 5432, database: "d", user: "u", password: "p", ssl: false },
    });
    expect(summary).toBe("u@h:5432/d");
  });
  it("exposes secret keys and a probe", () => {
    expect(postgres.config.secretKeys).toContain("password");
    expect(typeof postgres.driver.probe).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/techs/postgres/index.test.ts`
Expected: FAIL — cannot find `./index`.

- [ ] **Step 3: Write the module (re-exports existing driver, no relocation)**

```ts
// src/techs/postgres/index.ts
import { z } from "zod";
import type { TechModule } from "@/techs/contract";
import type { PostgresConfig, ConnectionRecord } from "@/lib/connections/types";
import { probePostgres } from "@/lib/connections/postgres";
import { OBJECT_PROVIDERS } from "@/lib/command-palette/object-providers";

const schema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  ssl: z.boolean(),
});

export const postgres: TechModule<PostgresConfig> = {
  id: "postgres",
  catalog: {
    id: "postgres",
    name: "PostgreSQL",
    tagline: "Relational database",
    description: "Run queries, browse schemas and inspect tables.",
    category: "Database",
    color: "from-indigo-400 to-violet-600",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<PostgresConfig>, secretKeys: ["password"] },
  driver: { probe: (c) => probePostgres(c) },
  summary: (r: ConnectionRecord) => {
    const c = r.config as PostgresConfig;
    return `${c.user}@${c.host}:${c.port}/${c.database}`;
  },
  firstPage: "",
  optionalDeps: ["pg"],
  serverPackages: ["pg"],
  commandObjects: OBJECT_PROVIDERS.postgres,
  capabilities: { browse: true, query: true, objectExplorer: true, health: true },
};
```

> Note: `commandObjects` reads from the existing `OBJECT_PROVIDERS` in Phase 2; Phase 3 inverts this so the provider map derives from modules. This temporary direction avoids a chicken-and-egg during the wrap step.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/techs/postgres/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/techs/postgres/
git commit -m "feat(techs): add postgres module (metadata + re-export)"
```

---

### Task 4: The remaining 10 modules

Create one `src/techs/<tech>/index.ts` per row, each with a sibling `index.test.ts` asserting `id`, `optionalDeps`, and `summary` output (copy Task 3's test shape, swap the values). All metadata is copied verbatim from the existing files cited in the spec. **Do not invent values — use the table below and the catalog/summaries source files.**

| tech | optionalDeps | serverPackages | firstPage | secretKeys | health body | commandObjects | capabilities |
|---|---|---|---|---|---|---|---|
| docker | `["dockerode","ssh2"]` | `["dockerode","ssh2"]` | `"containers"` | `[]` | `dockerBody` | — | `{browse:true,health:true}` |
| kafka | `["kafkajs","avsc"]` | `["kafkajs","avsc"]` | `""` | `["password"]` | `kafkaBody` | — | `{browse:true,health:true}` |
| mysql | `["mysql2"]` | `["mysql2"]` | `""` | `["password"]` | `mysqlBody` | `OBJECT_PROVIDERS.mysql` | `{browse:true,query:true,objectExplorer:true,health:true}` |
| sqlserver | `["mssql","tedious"]` | `["mssql","tedious"]` | `""` | `["password"]` | `sqlserverBody` | `OBJECT_PROVIDERS.sqlserver` | `{browse:true,query:true,objectExplorer:true,health:true}` |
| kubernetes | `["@kubernetes/client-node"]` | `["@kubernetes/client-node"]` | `"pods"` | `["kubeconfigYaml"]` | `kubernetesBody` | — | `{browse:true,health:true}` |
| redis | `["ioredis"]` | `["ioredis"]` | `"keys"` | `["password"]` | `redisBody` | — | `{browse:true,query:true,health:true}` |
| mongo | `["mongodb","bson"]` | `["mongodb"]` | `"databases"` | `["uri"]` | `mongoBody` | — | `{browse:true,query:true,objectExplorer:true,health:true}` |
| r2 | `["@aws-sdk/client-s3","@aws-sdk/lib-storage","@aws-sdk/s3-request-presigner"]` | _(none)_ | `""` | `["secretAccessKey"]` | `blobBody` | — | `{browse:true,upload:true,health:true}` |
| minio | _(same aws-sdk trio)_ | _(none)_ | `""` | `["secretKey"]` | `blobBody` | — | `{browse:true,upload:true,health:true}` |
| s3 | _(same aws-sdk trio)_ | _(none)_ | `""` | `["secretAccessKey","sessionToken"]` | `blobBody` | — | `{browse:true,upload:true,health:true}` |

Notes:
- `catalog` and `summary` bodies are copied verbatim from `src/lib/tech-catalog.ts` and `src/lib/connections/summaries.ts` respectively.
- Probe functions per tech (import from the existing driver file): docker→`probeDocker`, kafka→`probeKafka`, mysql→`probeMysql`, sqlserver→`probeSqlServer`, kubernetes→`probeKubernetes`, redis→`probeRedis`, mongo→`probeMongo`, r2/minio/s3→their existing probe in `r2.ts`/`minio.ts`/`s3-aws.ts`. If a probe export name differs, grep the driver file (`grep -n "export async function probe" src/lib/connections/<tech>.ts`) and use the real name.
- `health` bodies (`dockerBody` etc.) are currently **not exported** from `health.ts`. For Phase 2 set `health` to a thin wrapper that is wired properly in Phase 3 Task 9 — leave `health` **unset** here and let Phase 3 attach it. (Capabilities still declare `health:true` for UI.)
- The aws-sdk trio has no `serverPackages` (it bundles fine); leave `serverPackages` undefined for r2/minio/s3.

- [ ] **Step 1:** For each tech, write `index.test.ts` (id + optionalDeps + summary assertion). Run each, verify FAIL.
- [ ] **Step 2:** Write each `index.ts` per the table. Run each test, verify PASS.
- [ ] **Step 3: Commit**

```bash
git add src/techs/
git commit -m "feat(techs): add docker/kafka/mysql/sqlserver/kubernetes/redis/mongo/r2/minio/s3 modules"
```

---

### Task 5: The registry

**Files:**
- Create: `src/techs/registry.ts`
- Test: `src/techs/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/techs/registry.test.ts
import { describe, it, expect } from "vitest";
import { TECH_MODULES, TECH_MODULE_LIST, techById, requireTechModule } from "./registry";

const TECH_IDS = ["docker","kafka","postgres","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3"] as const;

describe("registry", () => {
  it("has exactly one module per TechId", () => {
    expect(Object.keys(TECH_MODULES).sort()).toEqual([...TECH_IDS].sort());
  });
  it("each module's key matches its id", () => {
    for (const [key, mod] of Object.entries(TECH_MODULES)) expect(mod.id).toBe(key);
  });
  it("techById looks up by id; requireTechModule throws on unknown", () => {
    expect(techById.get("postgres")?.id).toBe("postgres");
    expect(() => requireTechModule("nope" as never)).toThrow();
  });
  it("list order matches catalog connection order", () => {
    expect(TECH_MODULE_LIST.map((m) => m.id)).toEqual([
      "docker","postgres","kafka","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/techs/registry.test.ts`
Expected: FAIL — cannot find `./registry`.

- [ ] **Step 3: Write the registry**

```ts
// src/techs/registry.ts
import type { TechId } from "@/lib/connections/types";
import type { TechModule } from "./contract";
import { docker } from "./docker";
import { postgres } from "./postgres";
import { kafka } from "./kafka";
import { mysql } from "./mysql";
import { sqlserver } from "./sqlserver";
import { kubernetes } from "./kubernetes";
import { redis } from "./redis";
import { mongo } from "./mongo";
import { r2 } from "./r2";
import { minio } from "./minio";
import { s3 } from "./s3";

// Order here = home-grid connection order. `Record<TechId, …>` makes tsc fail
// if any TechId is missing a module — that is the completeness check.
export const TECH_MODULES: Record<TechId, TechModule> = {
  docker, postgres, kafka, mysql, sqlserver, kubernetes, redis, mongo, r2, minio, s3,
};

export const TECH_MODULE_LIST: TechModule[] = [
  docker, postgres, kafka, mysql, sqlserver, kubernetes, redis, mongo, r2, minio, s3,
];

export const techById = new Map<string, TechModule>(
  TECH_MODULE_LIST.map((m) => [m.id, m]),
);

export function requireTechModule(id: TechId): TechModule {
  const m = techById.get(id);
  if (!m) throw new Error(`No tech module registered for "${id}"`);
  return m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/techs/registry.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (proves every `TechId` has a module).

- [ ] **Step 5: Commit**

```bash
git add src/techs/registry.ts src/techs/registry.test.ts
git commit -m "feat(techs): add registry with TechId-completeness type check"
```

---

## Phase 3 — Flip core consumers to derive from the registry

> After each task, run `npm test && npm run typecheck`. Behavior must not change — these tasks delete duplicated literals and source them from modules instead.

### Task 6: Catalog derives from registry (+ keep `loadtest` tool entry)

**Files:**
- Modify: `src/lib/tech-catalog.ts`
- Test: `src/lib/tech-catalog.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tech-catalog.test.ts
import { describe, it, expect } from "vitest";
import { TECH_CATALOG, getTech } from "./tech-catalog";

describe("TECH_CATALOG", () => {
  it("includes all 11 connection techs and the loadtest tool", () => {
    const ids = TECH_CATALOG.map((t) => t.id);
    for (const id of ["docker","postgres","kafka","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3","loadtest"]) {
      expect(ids).toContain(id);
    }
  });
  it("loadtest is a tool, postgres is a connection", () => {
    expect(getTech("loadtest")?.kind).toBe("tool");
    expect(getTech("postgres")?.kind).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails / passes-but-for-wrong-reason**

Run: `npx vitest run src/lib/tech-catalog.test.ts`
Expected: PASS against the current hardcoded array (baseline). Keep it — it becomes the regression guard for the refactor.

- [ ] **Step 3: Rewrite the catalog to derive from the registry**

Replace the hardcoded `TECH_CATALOG` array (keep `TechCategory`, `TechMeta`, `TECH_CATEGORIES`, `getTech`, `techIconUrl` exactly as-is):

```ts
import { TECH_MODULE_LIST } from "@/techs/registry";

/** Standalone tools (no connection record). Hand-maintained — not TechModules. */
const TOOL_ENTRIES: TechMeta[] = [
  {
    id: "loadtest",
    name: "Load Testing",
    tagline: "k6 load tests",
    description: "Define, run, and track HTTP load tests against any REST API with k6.",
    category: "Testing",
    color: "from-amber-400 to-orange-600",
    status: "available",
    kind: "tool",
  },
];

export const TECH_CATALOG: TechMeta[] = [
  ...TECH_MODULE_LIST.map((m) => m.catalog),
  ...TOOL_ENTRIES,
];
```

> Watch for a circular import: `tech-catalog.ts` now imports the registry, and modules import `TechMeta` *type* from `tech-catalog.ts`. Type-only imports do not create a runtime cycle, but if Turbopack complains, move `TechMeta`/`TechCategory` into a new `src/lib/tech-types.ts` and re-export from `tech-catalog.ts`. Do this only if a cycle actually appears.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/tech-catalog.test.ts && npm run typecheck`
Expected: PASS — same catalog, now derived.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tech-catalog.ts src/lib/tech-catalog.test.ts
git commit -m "refactor(catalog): derive TECH_CATALOG from tech module registry"
```

---

### Task 7: Summaries derive from registry

**Files:**
- Modify: `src/lib/connections/summaries.ts`
- Test: `src/lib/connections/summaries.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connections/summaries.test.ts
import { describe, it, expect } from "vitest";
import { connectionSummaries } from "./summaries";

describe("connectionSummaries", () => {
  it("postgres summary unchanged", () => {
    const r = { id:"x", tech:"postgres" as const, name:"n", status:"ok" as const, createdAt:0,
      config:{ host:"h", port:5432, database:"d", user:"u", password:"p", ssl:false } };
    expect(connectionSummaries.postgres(r)).toBe("u@h:5432/d");
  });
  it("has a summary for every tech", () => {
    for (const id of ["docker","postgres","kafka","mysql","sqlserver","kubernetes","redis","mongo","r2","minio","s3"]) {
      expect(typeof connectionSummaries[id as keyof typeof connectionSummaries]).toBe("function");
    }
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/connections/summaries.test.ts` — PASS on current code (baseline guard).

- [ ] **Step 3: Rewrite to derive from registry**

```ts
// src/lib/connections/summaries.ts
import type { ConnectionRecord, TechId } from "./types";
import { TECH_MODULES } from "@/techs/registry";

export const connectionSummaries: Record<TechId, (r: ConnectionRecord) => string> =
  Object.fromEntries(
    (Object.entries(TECH_MODULES) as [TechId, (typeof TECH_MODULES)[TechId]][]).map(
      ([id, mod]) => [id, mod.summary],
    ),
  ) as Record<TechId, (r: ConnectionRecord) => string>;
```

- [ ] **Step 4:** Run `npx vitest run src/lib/connections/summaries.test.ts && npm run typecheck` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/summaries.ts src/lib/connections/summaries.test.ts
git commit -m "refactor(summaries): derive connectionSummaries from registry"
```

---

### Task 8: FIRST_PAGE + SECRET_KEYS derive from registry

**Files:**
- Modify: `src/lib/connections/first-page.ts`, `src/lib/connections/store.ts`
- Test: `src/lib/connections/first-page.test.ts` (create); existing `store.test.ts` is the regression guard.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connections/first-page.test.ts
import { describe, it, expect } from "vitest";
import { FIRST_PAGE, workspaceHref } from "./first-page";

describe("FIRST_PAGE", () => {
  it("matches known initial sections", () => {
    expect(FIRST_PAGE.docker).toBe("containers");
    expect(FIRST_PAGE.redis).toBe("keys");
    expect(FIRST_PAGE.mongo).toBe("databases");
    expect(FIRST_PAGE.postgres).toBe("");
  });
  it("workspaceHref uses the first page", () => {
    expect(workspaceHref("docker", "id1")).toBe("/docker/id1/containers");
    expect(workspaceHref("postgres", "id1")).toBe("/postgres/id1");
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/connections/first-page.test.ts` — PASS on current code (baseline).

- [ ] **Step 3a: Derive FIRST_PAGE** — replace the literal `FIRST_PAGE` object (keep `parseWorkspacePath` and `workspaceHref`):

```ts
import { TECH_MODULES } from "@/techs/registry";

export const FIRST_PAGE: Record<TechId, string> = Object.fromEntries(
  (Object.entries(TECH_MODULES) as [TechId, (typeof TECH_MODULES)[TechId]][]).map(
    ([id, mod]) => [id, mod.firstPage],
  ),
) as Record<TechId, string>;
```

- [ ] **Step 3b: Derive SECRET_KEYS** — in `src/lib/connections/store.ts` replace the literal `SECRET_KEYS` set:

```ts
import { TECH_MODULE_LIST } from "@/techs/registry";

// Union of every module's secret keys. Redaction/merge stay key-name-based and
// tech-agnostic — only the source of the list moved into the modules.
const SECRET_KEYS = new Set<string>(
  TECH_MODULE_LIST.flatMap((m) => m.config.secretKeys),
);
```

> The current literal set also contains `apiKey`, `serviceRoleKey`, `token`, `authToken` — keys for techs not yet modelled (supabase/etcd/etc. in the catalog ambition). To preserve exact current behavior, append these as a constant: `const EXTRA_SECRET_KEYS = ["apiKey","serviceRoleKey","token","authToken"];` and seed the set with both. This keeps redaction identical until those techs gain modules.

- [ ] **Step 4:** Run `npm test && npm run typecheck` — all PASS (esp. `store.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/first-page.ts src/lib/connections/first-page.test.ts src/lib/connections/store.ts
git commit -m "refactor(connections): derive FIRST_PAGE and SECRET_KEYS from registry"
```

---

### Task 9: Health + command-palette providers derive from registry

**Files:**
- Modify: `src/lib/connections/health.ts`, `src/lib/command-palette/object-providers.ts`, and the 3 module files that set `commandObjects` / 8 that set `health`.
- Test: existing `health.test.ts`; create `src/lib/command-palette/object-providers.test.ts`.

This task **inverts** the temporary direction from Phase 2: the per-tech `*Body` health functions and the SQL `commandObjects` providers become the source, exposed *through* the modules.

- [ ] **Step 1a: Export the health bodies.** In `health.ts`, add `export` to `postgresBody`, `redisBody`, `dockerBody`, `kafkaBody`, `mysqlBody`, `sqlserverBody`, `mongoBody`, `kubernetesBody`, and `blobBody`.

- [ ] **Step 1b: Attach `health` in each module.** In each `src/techs/<tech>/index.ts`, set `health` to the matching exported body (e.g. postgres: `health: postgresBody`; r2/minio/s3: `health: blobBody`). Import from `@/lib/connections/health`.

- [ ] **Step 2: Rewrite `probeFor` to dispatch via registry.** Replace the `switch` in `health.ts`:

```ts
import { techById } from "@/techs/registry";

function probeFor(conn: ConnectionRecord): Promise<ProbeBody> {
  const probe = techById.get(conn.tech)?.health;
  return probe ? (probe(conn) as Promise<ProbeBody>) : reachabilityOnly(conn);
}
```

> `ProbeBody` stays defined in `health.ts`; `HealthProbe` in the contract returns `unknown` to avoid importing `ProbeBody` into core types. The cast above is the single bridge point.

- [ ] **Step 3: Invert OBJECT_PROVIDERS.** In `object-providers.ts`, keep the three provider implementations (`postgresProvider`, `mysqlProvider`, `sqlserverProvider`) and **export** them. Modules already reference `OBJECT_PROVIDERS.<tech>` (Phase 2) — change them to import the named providers directly to break the cycle:
  - In `src/techs/postgres/index.ts`: `import { postgresProvider } from "@/lib/command-palette/object-providers"` → `commandObjects: postgresProvider`.
  - Same for mysql/sqlserver.
  - Then redefine the map by deriving from the registry:

```ts
import { TECH_MODULE_LIST } from "@/techs/registry";
import type { TechId } from "@/lib/connections/types";

export const OBJECT_PROVIDERS: Partial<Record<TechId, ObjectProvider>> =
  Object.fromEntries(
    TECH_MODULE_LIST.filter((m) => m.commandObjects).map((m) => [m.id, m.commandObjects!]),
  );
```

> If exporting the providers and importing them into modules creates a cycle (object-providers → registry → module → object-providers), break it by moving the three provider function bodies into `src/lib/command-palette/sql-providers.ts`, importing them into both the modules and `object-providers.ts`. Apply only if a cycle appears.

- [ ] **Step 4: Test**

```ts
// src/lib/command-palette/object-providers.test.ts
import { describe, it, expect } from "vitest";
import { OBJECT_PROVIDERS } from "./object-providers";

describe("OBJECT_PROVIDERS", () => {
  it("only the SQL techs expose providers", () => {
    expect(Object.keys(OBJECT_PROVIDERS).sort()).toEqual(["mysql","postgres","sqlserver"]);
  });
});
```

Run: `npm test && npm run typecheck` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/health.ts src/lib/command-palette/object-providers.ts src/techs/
git commit -m "refactor(health,palette): dispatch health probes and object providers via registry"
```

---

### Task 10: `serverExternalPackages` codegen

**Files:**
- Create: `scripts/gen-server-packages.ts`, `src/techs/server-packages.generated.ts` (committed output), `scripts/gen-server-packages.test.ts`
- Modify: `next.config.ts`, `package.json`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/gen-server-packages.test.ts
import { describe, it, expect } from "vitest";
import { SERVER_EXTERNAL_PACKAGES } from "@/techs/server-packages.generated";
import { TECH_MODULE_LIST } from "@/techs/registry";

describe("server-packages.generated", () => {
  it("equals the deduped union of module serverPackages", () => {
    const expected = [...new Set(TECH_MODULE_LIST.flatMap((m) => m.serverPackages ?? []))].sort();
    expect([...SERVER_EXTERNAL_PACKAGES].sort()).toEqual(expected);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run scripts/gen-server-packages.test.ts` — FAIL (no generated file yet).

- [ ] **Step 3a: Write the codegen script**

```ts
// scripts/gen-server-packages.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TECH_MODULE_LIST } from "../src/techs/registry";

const pkgs = [...new Set(TECH_MODULE_LIST.flatMap((m) => m.serverPackages ?? []))].sort();
const body =
  `// AUTO-GENERATED by scripts/gen-server-packages.ts — do not edit by hand.\n` +
  `export const SERVER_EXTERNAL_PACKAGES = ${JSON.stringify(pkgs, null, 2)} as const;\n`;
writeFileSync(resolve(__dirname, "../src/techs/server-packages.generated.ts"), body);
console.log(`Wrote ${pkgs.length} server external packages.`);
```

- [ ] **Step 3b: Generate the file and add npm scripts**

Run: `npx tsx scripts/gen-server-packages.ts`

In `package.json` add:
```json
"predev": "tsx scripts/gen-server-packages.ts",
"prebuild": "tsx scripts/gen-server-packages.ts"
```

- [ ] **Step 3c: Consume it in `next.config.ts`**

```ts
import type { NextConfig } from "next";
import { SERVER_EXTERNAL_PACKAGES } from "./src/techs/server-packages.generated";

const nextConfig: NextConfig = {
  serverExternalPackages: [...SERVER_EXTERNAL_PACKAGES],
};

export default nextConfig;
```

> The generated list must contain every package currently in `next.config.ts`: `dockerode`, `ssh2`, `kafkajs`, `avsc`, `pg`, `mysql2`, `mssql`, `tedious`, `@kubernetes/client-node`, `ioredis`, `mongodb`. Confirm the module `serverPackages` declarations (Task 4 table) produce exactly this set. If any are missing, the corresponding module's `serverPackages` is wrong — fix the module, not the config.

- [ ] **Step 4: Verify**

Run: `npx vitest run scripts/gen-server-packages.test.ts && npm run build`
Expected: test PASS; build succeeds with native packages externalized.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-server-packages.ts scripts/gen-server-packages.test.ts src/techs/server-packages.generated.ts next.config.ts package.json
git commit -m "feat(build): generate serverExternalPackages from tech modules"
```

---

## Phase 4 — Harden drivers (optional deps + lazy import + graceful absence)

### Task 11: `formatError` recognizes `DriverNotInstalledError`

**Files:**
- Modify: `src/lib/errors.ts`
- Test: `src/lib/errors.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/errors.test.ts
import { describe, it, expect } from "vitest";
import { formatError } from "./errors";
import { DriverNotInstalledError } from "@/techs/contract";

describe("formatError + DriverNotInstalledError", () => {
  it("returns the install hint message", () => {
    const msg = formatError(new DriverNotInstalledError("postgres", "pg"));
    expect(msg).toContain("pg");
    expect(msg).toContain("npm i pg");
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/errors.test.ts` — likely PASS already (the error has a `.message`, and `formatError` returns `msg`). If PASS, this is a regression guard; proceed. If the `code`-suffix path interferes, add an explicit branch:

```ts
// at the top of formatError, after the `err instanceof Error` check:
if (err instanceof Error && err.name === "DriverNotInstalledError") return err.message;
```

(Import is not needed — match by `name` to avoid a core→techs dependency.)

- [ ] **Step 3:** Implement the branch above only if needed.
- [ ] **Step 4:** Run `npx vitest run src/lib/errors.test.ts` — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts src/lib/errors.test.ts
git commit -m "feat(errors): surface DriverNotInstalledError message cleanly"
```

---

### Task 12: Pilot — relocate + lazify the `postgres` driver

**Files:**
- Create: `src/techs/postgres/driver.ts`
- Modify: `src/lib/connections/postgres.ts` (becomes a re-export shim), `package.json`
- Test: existing `src/lib/connections/postgres-readonly.test.ts` + `sql-safety.test.ts` are the behavior guards.

- [ ] **Step 1: Move `pg` to optionalDependencies.** In `package.json`, cut `"pg"` from `dependencies` and add to a new `optionalDependencies` block. Keep `@types/pg` in devDependencies.

- [ ] **Step 2: Relocate the driver and lazify the import.** Move the full contents of `src/lib/connections/postgres.ts` to `src/techs/postgres/driver.ts`. Replace the top line:

```ts
// OLD: import { Client, type ClientConfig } from "pg";
import type { Client as PgClient, ClientConfig } from "pg"; // type-only — erased at runtime
import { DriverNotInstalledError } from "@/techs/contract";

let pgMod: typeof import("pg") | null = null;
async function getPg(): Promise<typeof import("pg")> {
  try {
    return (pgMod ??= await import("pg"));
  } catch {
    throw new DriverNotInstalledError("postgres", "pg");
  }
}
```

Then in `withClient` (the one place that does `new Client(...)`), replace `new Client(cfg)` with:

```ts
const { Client } = await getPg();
const client: PgClient = new Client(cfg);
```

> Type-only `import type` of `pg` is erased at build time, so the optional package being absent does not break the type check (types are present in the dev repo). Runtime resolution happens solely through `getPg()`.

- [ ] **Step 3: Turn the old file into a shim** so existing route imports keep working:

```ts
// src/lib/connections/postgres.ts
export * from "@/techs/postgres/driver";
```

And update `src/techs/postgres/index.ts` to import `probePostgres` from `./driver` instead of `@/lib/connections/postgres`.

- [ ] **Step 4: Verify behavior unchanged**

Run: `npm test && npm run typecheck`
Expected: `postgres-readonly.test.ts`, `sql-safety.test.ts`, and all module/consumer tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/techs/postgres/driver.ts src/lib/connections/postgres.ts src/techs/postgres/index.ts package.json
git commit -m "refactor(postgres): relocate driver to module, lazy-import pg as optional dep"
```

---

### Task 13: Graceful absence in the API + home grid

**Files:**
- Modify: `src/app/api/postgres/test/route.ts` (and the per-id route base) to map `DriverNotInstalledError` → `503`.
- Modify: the home-grid tile component to dim techs whose drivers are absent.
- Test: `src/techs/presence.test.ts` already covers detection; add a route-level unit test if the route logic is extracted.

- [ ] **Step 1: Map the error to 503 in routes.** Routes already `catch` and call `formatError`. Add status discrimination. In `src/app/api/postgres/test/route.ts` catch block:

```ts
} catch (err) {
  const status = err instanceof Error && err.name === "DriverNotInstalledError" ? 503 : 500;
  return NextResponse.json({ error: formatError(err) }, { status });
}
```

> Repeat for the other tech `test` routes and `[id]` routes in Phase 4's per-tech rollout (Task 14). Consider a shared `errorResponse(err)` helper in `src/lib/errors.ts` to DRY this — add it and use it:

```ts
// src/lib/errors.ts
import { NextResponse } from "next/server";
export function errorResponse(err: unknown) {
  const status = err instanceof Error && err.name === "DriverNotInstalledError" ? 503 : 500;
  return NextResponse.json({ error: formatError(err) }, { status });
}
```

- [ ] **Step 2: Dim absent techs on the home grid.** Locate the grid (`grep -rln "TECH_CATALOG" src/components src/app`). Compute `installed` per tech with `modulesInstalled` from `@/techs/presence` — but note `presence.ts` uses Node `require.resolve`, so it must run server-side. Pass an `installed: boolean` map from the server component (the home page is a server component) into the grid as a prop. For each connection tech, when `!installed`, render the tile dimmed with a tooltip: `Driver not installed — npm i <optionalDeps>`.

- [ ] **Step 3: Test** — add a server-side test asserting `modulesInstalled(postgres)` is `true` in the dev repo (drivers installed by default), and that a synthetic module with a bogus `optionalDeps` reports `false`.

```ts
import { modulesInstalled } from "@/techs/presence";
import { postgres } from "@/techs/postgres";
it("postgres reports installed in dev", () => expect(modulesInstalled(postgres)).toBe(true));
```

- [ ] **Step 4:** Run `npm test && npm run build` — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts src/app/api/postgres/ src/components/ src/app/page.tsx
git commit -m "feat(techs): 503 on missing driver + dim absent techs on home grid"
```

---

### Task 14: Roll the lazy/optional pattern across the remaining 10 drivers

Apply Task 12's exact pattern to each tech, one commit per tech. For each:

1. Move its dep(s) from `dependencies` → `optionalDependencies` in `package.json` (see optionalDeps column in Task 4 table; `bson`, `ssh2`, `tedious`, `avsc` move with their parents).
2. Relocate `src/lib/connections/<tech>.ts` → `src/techs/<tech>/driver.ts`; replace top-level driver import with a type-only import + a `get<Pkg>()` lazy loader throwing `DriverNotInstalledError(<tech>, <pkg>)`.
3. Leave `src/lib/connections/<tech>.ts` as `export * from "@/techs/<tech>/driver";` so existing route/UI imports keep resolving.
4. Point the module's `index.ts` probe import at `./driver`.
5. Map `DriverNotInstalledError` → 503 in that tech's routes via `errorResponse`.

Per-tech specifics (grep the real driver-package import name first: `grep -nE "^import .* from \"(dockerode|kafkajs|mysql2|mssql|ioredis|mongodb|@kubernetes/client-node|@aws-sdk)" src/lib/connections/<file>.ts`):

| tech | driver file(s) | package(s) to lazify |
|---|---|---|
| docker | `docker.ts`, `compose.ts`, `terminal-sessions.ts` | `dockerode` (`ssh2` is transitive) |
| kafka | `kafka.ts`, `kafka-schema-registry.ts` | `kafkajs`, `avsc` |
| mysql | `mysql.ts` | `mysql2` |
| sqlserver | `sqlserver.ts` | `mssql` (`tedious` transitive) |
| kubernetes | `kubernetes.ts`, `kubernetes-sessions.ts` | `@kubernetes/client-node` |
| redis | `redis.ts` | `ioredis` |
| mongo | `mongo.ts` | `mongodb`, `bson` |
| r2/minio/s3 | shared `s3.ts` (+ `s3-aws.ts`) | `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` |

> **Blob trio caveat:** `s3.ts` is shared by r2/minio/s3. Lazify it once. Since three modules share it, the `DriverNotInstalledError` tech arg can't be a single literal — pass the active tech down, or throw with the first consuming tech and accept a generic `"s3"` label. Simplest: a `DriverNotInstalledError("s3", "@aws-sdk/client-s3")` since the package is shared; the install hint is identical for all three.

- [ ] For each tech: relocate + lazify + shim + module import + route 503 → run `npm test && npm run typecheck` → commit `refactor(<tech>): lazy-import driver as optional dependency`.

> **Verification gate after the last tech:** run the full suite, `npm run build`, and manually start `npm run dev` to confirm every workspace still loads. Then run a lean check: `npm ci --omit=optional` in a scratch checkout, start the app, and confirm it boots and tiles render "driver not installed" instead of crashing. (Re-run `npm install` afterward to restore drivers.)

---

## Phase 5 — Documentation

### Task 15: Rewrite "Adding a new technology" in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1:** Replace the 9-step "Adding a new technology" section with the new flow:

```markdown
## Adding a new technology

1. Add a `TechId` literal in `src/lib/connections/types.ts` and a config interface.
2. Create `src/techs/<tech>/` with:
   - `driver.ts` — probe + operations. Lazy-import the npm package behind a
     `get<Pkg>()` guard that throws `DriverNotInstalledError`.
   - `index.ts` — `export const <tech>: TechModule = { … }` (catalog, config schema +
     secretKeys, driver, summary, firstPage, optionalDeps, serverPackages,
     capabilities, optional health/commandObjects).
3. Register it: add one import + one entry to `src/techs/registry.ts`.
4. Add the npm driver to `optionalDependencies` in `package.json`.
5. Build routes under `src/app/api/<tech>/` (import the driver from `@/techs/<tech>/driver`;
   wrap handlers' errors with `errorResponse`).
6. Build the workspace under `src/app/<tech>/` (form + `[connectionId]` pages).

`serverExternalPackages` is generated from module `serverPackages` (no manual
next.config edit). Catalog, summaries, FIRST_PAGE, secret keys, health probes,
and command-palette object providers all derive from the registry automatically.
```

- [ ] **Step 2:** Update the "In-memory stores" / `serverExternalPackages` references elsewhere in AGENTS.md to point at the generated file.
- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: rewrite 'Adding a new technology' for the module/registry flow"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** Contract (Task 1) ✓; registry + completeness check (Task 5) ✓; lazy/optional drivers (Tasks 12, 14) ✓; graceful absence (Tasks 11, 13) ✓; de-scatter of catalog/summaries/first-page/secrets/health/palette (Tasks 6–9) ✓; codegen for `serverExternalPackages` (Task 10) ✓; incremental rollout with register-before-relocate (Phases 2–3 before 4) ✓; postgres pilot then docker/rest (Tasks 12, 14) ✓; docs (Task 15) ✓; non-goals (lean install, runtime host, package extraction) intentionally excluded ✓.
- **Placeholder scan:** No "TBD"/"similar to". The 10-module and 10-driver repetitions are table-driven with concrete per-tech values, not vague references.
- **Type consistency:** `TechModule`, `TechDriver`, `DriverNotInstalledError`, `modulesInstalled`, `TECH_MODULES`/`TECH_MODULE_LIST`/`techById`/`requireTechModule`, `SERVER_EXTERNAL_PACKAGES`, `errorResponse` are named identically wherever referenced. `health` returns `unknown` in the contract and is cast to `ProbeBody` only at the single dispatch bridge in `health.ts`.
- **Known risk flagged inline:** potential import cycles in Tasks 6 and 9, each with a concrete break-glass remedy (extract types / extract sql-providers) to apply only if a cycle actually appears.
