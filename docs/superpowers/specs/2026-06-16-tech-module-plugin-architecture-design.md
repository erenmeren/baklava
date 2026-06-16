# Tech Module Plugin Architecture — Design

**Date:** 2026-06-16
**Status:** Approved (design); ready for implementation planning

## Problem

Baklava integrates ~12 technologies today (docker, kafka, kubernetes, postgres,
mysql, sqlserver, mongo, redis, minio, r2, s3) and the catalog reaches toward
~20. Adding one technology is a documented **9-step ritual** spread across
unrelated files:

- `src/lib/connections/types.ts` — `TechId` union + config interface
- `src/lib/tech-catalog.ts` — catalog entry (icon, gradient, tagline, slug)
- `src/lib/connections/summaries.ts` — `connectionSummaries[tech]`
- `src/lib/connections/<tech>.ts` — driver (probe + operations)
- `next.config.ts` — `serverExternalPackages`
- `src/app/api/<tech>/...` — API routes
- `src/app/<tech>/...` — form + workspace
- `src/components/connection-tabs.ts` / `first-page.ts` — `FIRST_PAGE`
- command palette — `OBJECT_PROVIDERS`

A "technology" is therefore not one thing you can hold in your hand — it is a
diff across nine files. As integrations grow this scatter is the bottleneck,
and core code hard-depends on every driver (`pg`, `mongodb`, `@aws-sdk/*`,
`@kubernetes/client-node`, …).

## Goal

Establish a clean module boundary so a technology is **one object satisfying one
interface**, and core derives everything from a **registry** of those objects
rather than hardcoding each tech. Drivers become an **optional dependency**
boundary that core never hard-imports, degrading gracefully when absent.

Explicitly **in scope**: the contract, registry-driven discovery, lazy-loaded
drivers, optional-dependency boundaries, graceful absence handling.

Explicitly **out of scope** (deferred until proven / a real need appears):
runtime plugin host, lean/profile install workflow, third-party marketplace,
monorepo package extraction, lifecycle concerns (migrations, etc.). The design
keeps these *unblocked* but does not build them.

## Non-goals / accepted trade-offs

- **This does not shrink a default `npm install`.** Optional dependencies
  install by default. Disk savings only materialize when someone deliberately
  trims (`npm install --omit=optional` + a trimmed registry). The payoff this
  phase is the *boundary*, not byte-shaving — matching the stated priority of
  "extensibility first, distribution optimization second."
- **No runtime installation.** Next.js App Router resolves routes and the client
  bundle at build time. "Installable independently" means build-time
  modular: a tech is one isolated module + one optional dependency that can be
  cleanly omitted, not a runtime drop-in.

## Architecture

### The `TechModule` contract

Lives in core as pure types — the single interface every technology satisfies.

```ts
// src/techs/contract.ts
interface TechModule<C extends BaseConfig = BaseConfig> {
  id: TechId;                         // canonical union still defined in types.ts
  catalog: CatalogEntry;              // icon, gradient, tagline, category, status, slug
  config: {
    schema: ZodSchema<C>;             // validation for form + API
    secretKeys: (keyof C)[];          // redaction / "(unchanged)" handling — moved OUT of central redactConfig
    defaults?: Partial<C>;
  };
  driver: TechDriver<C>;              // probe(config) + operations; LAZY-imports the npm package
  summary: (conn) => ConnectionSummary;
  firstPage: string;                  // FIRST_PAGE entry
  optionalDeps: string[];             // npm packages this tech needs, e.g. ["pg"]
  serverPackages?: string[];          // contribution to serverExternalPackages
  health?: HealthProbe;               // dashboard probe (optional)
  commandObjects?: ObjectProvider;    // command palette OBJECT_PROVIDERS (pg/mysql/mssql only)
  capabilities?: {                    // UI adapts generically; absent flag = false
    browse?: boolean;                 // list/inspect objects (tables, topics, keys…)
    query?: boolean;                  // query/console editor
    upload?: boolean;                 // object upload (blob techs)
    objectExplorer?: boolean;         // tree-style navigator
    vectorSearch?: boolean;
    graphTraversal?: boolean;
    health?: boolean;                 // participates in dashboard probes
  };
}
```

Decisions baked into the contract:

- **The driver is the only dependency boundary.** It is the sole place that
  touches the npm package, and it does so via lazy `import()`. Everything else
  in the module is pure metadata or function references.
- **`secretKeys` lives in the module.** Per-tech secret knowledge belongs with
  the tech, not in a central `redactConfig` switch.
- **`capabilities` is additive and optional.** It lets the UI key off declared
  capability instead of `if (tech === "x")` conditionals. It can grow without
  forcing contract churn, which is why it exists now rather than later.
- **UI/routes stay under `src/app/<tech>/...` for this phase.** They import their
  driver/config from the module instead of from `src/lib/connections`.
  Relocating UI into the module is the future bridge to package extraction and
  is deliberately not done now — this keeps the refactor from fighting the App
  Router.
- **Shared cores are allowed.** `minio`/`r2`/`s3` remain thin modules over the
  existing shared `s3.ts` / `blob-*` helpers. The contract does not force every
  tech to be standalone.
- **No `migrations`/lifecycle field** until a real use case appears.

### The registry — single source of truth

```ts
// src/techs/registry.ts
import { postgres } from "./postgres";
import { mysql }    from "./mysql";
// …one import per tech

export const TECH_MODULES = [postgres, mysql, docker, kafka, /* … */] as const;

export const techById = new Map(TECH_MODULES.map(m => [m.id, m]));
export function requireTechModule(id: TechId): TechModule { /* throws if absent */ }
```

Core consumers stop holding per-tech literals and **derive from the registry**:

| Today (edit per tech) | After |
|---|---|
| `tech-catalog.ts` hand-listed entries | `TECH_MODULES.map(m => m.catalog)` |
| `summaries.ts` `connectionSummaries[tech]` | `techById.get(id).summary` |
| `first-page.ts` `FIRST_PAGE` | `m.firstPage` |
| command palette `OBJECT_PROVIDERS` | `TECH_MODULES.filter(m => m.commandObjects)` |
| `redactConfig` central secret keys | `m.config.secretKeys` |
| `health.ts` per-tech probes | `m.health` |
| `next.config.ts` `serverExternalPackages` | generated from `m.serverPackages` |

**Result: adding a tech = create `src/techs/<tech>/` + add one line to
`registry.ts`.** The 9-step ritual collapses to 2.

Two deliberate constraints:

1. **`TechId` stays a hand-maintained union in `types.ts`** — a pure type with
   zero runtime deps, referenced everywhere. Keeping it explicit lets
   TypeScript *check* that the registry covers every `TechId`. Deriving it from
   the registry buys little and invites circular dependencies.
2. **`next.config.ts` cannot import the full registry** (it runs early in the
   build and the registry transitively reaches driver code). `serverExternalPackages`
   is produced by a **small, deterministic codegen step**:
   `scripts/gen-server-packages.ts` imports `TECH_MODULES`, flat-maps
   `serverPackages`, and writes a zero-import
   `export const SERVER_EXTERNAL_PACKAGES = [...]` to
   `src/techs/server-packages.generated.ts`. Importing the registry there is
   safe precisely because drivers are lazy-imported inside functions — importing
   a module index pulls metadata/function refs, never `pg`/`mongodb`. Runs as a
   `prebuild`/`predev` step. ~30 lines, no pipeline.

### Optional dependencies & graceful absence

Two coordinated changes establish the boundary:

1. **Drivers move `dependencies → optionalDependencies`** in `package.json`:
   `pg`, `mysql2`, `mssql`, `tedious`, `mongodb`, `ioredis`, `dockerode`,
   `kafkajs`, `avsc`, `@kubernetes/client-node`, `@aws-sdk/*`. A default
   `npm install` still installs them; `--omit=optional` + a trimmed registry
   yields the lean core.

2. **Every driver lazy-imports behind a guard**, replacing top-level
   `import { Client } from "pg"`:

```ts
// src/techs/postgres/driver.ts
let mod: typeof import("pg") | null = null;
async function pg() {
  try { return (mod ??= await import("pg")); }
  catch { throw new DriverNotInstalledError("postgres", "pg"); }
}
```

`DriverNotInstalledError` (new, in core) is recognized by `formatError` and
surfaces cleanly instead of an opaque `MODULE_NOT_FOUND`:

- **API routes** → `503` with `{ error: "postgres driver not installed", install: "npm i pg" }`.
- **Home grid** → a tech whose `optionalDeps` are unresolvable renders as
  **"not installed"** (dimmed, with install hint) rather than appearing broken
  when clicked.

Presence is resolved **once at startup** via a cheap `require.resolve` check per
module's `optionalDeps`, cached as `installed: boolean` per tech. The catalog and
home grid read that flag — no per-request import cost.

## Rollout (incremental; `tsc` + the 425-test suite green at every step)

Registration and relocation are **decoupled** so the de-scatter win lands early
and driver hardening trickles in tech-by-tech.

1. **Infra, zero behavior change.** Add `contract.ts`, `registry.ts`,
   `DriverNotInstalledError`, and the startup presence-check util. Nothing
   consumes them yet.
2. **Wrap every tech as a module — do not move code.** Each
   `src/techs/<tech>/index.ts` declares metadata (catalog, summary, secretKeys,
   firstPage, optionalDeps, serverPackages, capabilities, commandObjects) and
   *re-exports its existing `src/lib/connections/<tech>.ts` driver as-is*.
   Register all in `registry.ts`. Pure addition; imports elsewhere unchanged.
3. **Flip core consumers to derive from the registry** and delete the scattered
   literals (tech-catalog, summaries, first-page, command-palette
   `OBJECT_PROVIDERS`, `redactConfig` secrets, `health`, the `next.config`
   codegen). `tsc` now enforces that every `TechId` has a module. **Adding a tech
   is already the 2-step flow at this point.**
4. **Harden drivers, one tech per PR-sized unit (parallelizable).** Relocate the
   driver into `src/techs/<tech>/driver.ts`, convert top-level `import` → lazy
   guarded import, move its dep to `optionalDependencies`, wire the `503` +
   dimmed-tile absence path. **Pilot: `postgres`** (richest — query / browse /
   objectExplorer / commandObjects / health / readonly-safety stresses the whole
   contract), then **`docker`** (streaming / sessions, a different axis). The
   rest follow the proven template. `minio`/`r2`/`s3` migrate as thin modules
   over the untouched shared `s3.ts` / `blob-*` core.
5. **Rewrite the AGENTS.md "Adding a new technology"** section from the 9-step
   ritual to the 2-step (`create module` + `register`).

Steps 1–3 are the architectural core and land together-ish. Step 4 trickles in
without blocking anything.

## Testing

- Existing suite (425 tests across 59 files) + `tsc --noEmit` gate every step.
- `tsc` enforces registry completeness against the `TechId` union.
- New unit tests: presence-check util (resolvable vs. absent dep),
  `DriverNotInstalledError` → `formatError` → `503` mapping, and the codegen
  output (`SERVER_EXTERNAL_PACKAGES` matches the union of module `serverPackages`).
- Per-tech hardening (step 4) reuses each tech's existing driver/readonly tests
  unchanged — relocation must not alter behavior.

## Future (unblocked, not built)

- **Package extraction (monorepo).** Co-locate each tech's UI into its module and
  lift to `@baklava/tech-*` workspace packages. The contract is the public API,
  so this becomes mechanical rather than a rewrite.
- **Third-party integrations.** A conforming external package + a registry entry.
- **Lean/profile install + a "download/add tech" CLI workflow.** Evaluate once
  there are more integrations and the boundary is proven.
