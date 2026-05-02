# baklava — agent guide

This file is loaded by Claude Code (and similar agents) at session start. Read it
before doing anything substantive in this repo.

## What baklava is

A unified developer console for the modern stack. Federated SQL queries across
data services (Postgres, Mongo, Redis, Kafka, S3) and infrastructure services
(Docker, Kubernetes, RabbitMQ) using DuckDB as the federation engine and a
plugin SDK for sources. The user types a natural-language question; an AI
translates it to a SQL plan; the validator gates the plan; the pipeline fetches
from each declared source and executes the join in DuckDB.

The full design doc lives at:
`~/.gstack/projects/baklava/eren-main-design-20260502-214731.md`
(local to the maintainer's machine, not committed).

## Status

| Layer | Commit | What's done |
|---|---|---|
| 1 — Security spine | `a15c589` | errors, config, duck wrapper, AI plan validator |
| 2 — Sources + AI + pipeline | `c24faf1` | Plugin interface, SQLite + Postgres connectors, prompt builder, AI plan caller, retry layer, pipeline orchestrator |
| 3 — UI + CLI + demo | (in progress) | CSRF middleware, Next.js scaffold, API routes, `npx baklava --demo` |

91 tests, all green, on Node 20 + 22 via GitHub Actions.

## Architecture, in one paragraph

`runQuery(nl, sources, generator)` is the single entry point in `lib/pipeline.ts`.
It builds a list of `{connection, table → tableAlias, columns}` schemas, hands
them to `lib/ai/plan.ts` (which calls Claude via the Vercel `ai` SDK), gets back a
structured plan `{plan_english, sources, sql}`, runs it through
`lib/ai/validate.ts` (a three-layer gate: `node-sql-parser` AST allowlist +
DuckDB `EXPLAIN` against a fresh empty instance with stub tables matching the
declared schemas), then fetches each declared source via `plugin.fetchRows`,
registers the rows in a fresh per-query DuckDB `:memory:` instance, executes the
SQL, coerces BigInts back to Numbers, and returns the result with timing
breakdown and truncation flags.

## File layout

```
lib/
  errors.ts              BaklavaError shape + 25-code registry
  config.ts              ~/.baklava/{connections,config,instance}.json + chmod 600
  duck.ts                withDuck() wrapper — fresh per-query Database
  pipeline.ts            runQuery() orchestrator (the headline entry point)
  ai/
    prompt.ts            buildPrompt() + tableAliasFor() — pure, snapshot-tested
    plan.ts              Vercel ai SDK + @ai-sdk/anthropic, JSON parsing
    retry.ts             one auto-retry on validator failure
    validate.ts          THE security model — three-layer SQL gate
  sources/
    types.ts             Plugin interface, FilterClause AST, SDK_VERSION
    sqlite.ts            via better-sqlite3 (powers --demo)
    postgres.ts          via pg
  security.ts            (Layer 3) Origin/Host/X-Baklava-Token middleware

app/                     (Layer 3) Next.js App Router
  page.tsx               main query box + result table
  api/v1/
    health/route.ts
    query/route.ts       NL → pipeline → JSON
    connections/route.ts CRUD over connections.json
    config/route.ts      AI key entry

bin/baklava.ts           (Layer 3) CLI: --demo, --port, version, doctor
demo/seed-sqlite.ts      (Layer 3) bundled SQLite pair for --demo

tests/
  unit/                  vitest, all libs, no I/O outside tmp dirs
  integration/           pipeline.test.ts — real SQLite + DuckDB, mocked AI
  e2e/                   (Layer 3) Playwright happy-path
```

## The security model — read this before touching `lib/ai/validate.ts`

The validator is the load-bearing wall. If it leaks, the AI can read arbitrary
files (`SELECT * FROM read_json_auto('/etc/passwd')`), exfiltrate data from a
connection it wasn't asked to use (phantom-table attack), or escape DuckDB's
sandbox via `ATTACH`/`INSTALL`/`LOAD`.

Three layers, in order:
1. **Parse** the SQL with `node-sql-parser` (Postgres dialect). Reject if it
   doesn't parse, has multiple statements, or isn't rooted in `SELECT`.
2. **Walk the AST.** Reject any node whose type is in `FORBIDDEN_AST_TYPES`
   (DML, DDL, transactions, ATTACH, PRAGMA, INSTALL, LOAD, COPY, CALL,
   EXPORT, IMPORT). Reject any FROM entry that's a function call instead of a
   table reference. Reject any `read_*` / `attach` / `load` / `install` /
   `copy` function call anywhere.
3. **Bind against a fresh DuckDB instance** that contains only the declared
   sources as empty stub tables. Run `EXPLAIN <sql>`. If DuckDB can't bind the
   query (because it references an undeclared table or column), reject.

If you're adding a new attack class to test, put it in
`tests/unit/validate.test.ts` and make the validator block it before merging.
The validator's tests are the canary. Any new commit that loosens the
allowlist needs a strong justification in the commit message.

## Per-query DuckDB — non-negotiable

`lib/duck.ts` exports `withDuck<T>(fn)` which opens a fresh `Database(':memory:')`,
runs `fn`, and closes. **Never** share a DuckDB instance across queries. This
closes three risks at once: phantom-table attack from a prior query's
residual registration, concurrent-request race, and unbounded memory growth.

If you find yourself writing a singleton DuckDB instance, stop.

## Plugin authoring quick-ref

Implement `Plugin<H>` from `lib/sources/types.ts`. A plugin must:
- `validateConfig(c)` — throw `BaklavaException` on bad input. No I/O.
- `connect(c)` — open the connection, return an opaque handle. Smoke-test with
  a `SELECT 1`-equivalent before returning.
- `health(handle)` — fast (`<1s`), used by the "Test Connection" button.
- `listTables(handle)` — return `SchemaInfo[]` with each column's
  `nativeType` and `duckdbType`. The DuckDB type drives the federation.
- `fetchRows(handle, spec)` — yield rows up to `spec.limit`. Reject undeclared
  columns and undeclared filter columns inline (don't trust the caller).
  Use parameter binding — never string-concat user input into SQL.
- `disconnect(handle)` — release pool/client.

`FilterClause` (in `lib/sources/types.ts`) is the structured filter AST. The
host pushes it down via `FetchSpec.where`; plugins compile it to native SQL
or filter API calls. Use a switch on `clause.op` and rely on the
`Exclude<FilterClause, { op: "and" | "or" }>` cast for narrowing the leaf
case (TS's `||` discriminator narrowing is unreliable here).

## Conventions

- **No file extensions in relative imports.** Write
  `import { x } from "../lib/foo"`, not `"../lib/foo.js"` or `"../lib/foo.ts"`.
  Reason: Next.js's bundler (Turbopack) won't auto-resolve `.js → .ts` like
  Vitest's Vite resolver does, and `.ts` extensions are rejected by
  `allowImportingTsExtensions: false`. Extension-less imports work everywhere
  (Vitest, tsx, Next.js dev + build).
- **No emojis in code or commit messages** unless the user explicitly asks.
- **No `any`. No type assertions** except for the documented FilterClause
  narrowing pattern.
- **Errors are `BaklavaError`**, never raw strings. Every code is registered in
  `lib/errors.ts`. Adding a new error class? Add the code there too.
- **Commit messages follow Conventional Commits** (`feat:`, `fix:`, `chore:`).
  The body explains the *why*, the diff shows the *what*.
- **Don't `git add -A`** — stage specific files. The repo already has both
  `bun.lock` and `package-lock.json`; both should be committed when deps
  change.

## Testing

- `bunx vitest run` — full suite (or `npm test`).
- `bunx tsc --noEmit` — typecheck.
- Test file naming: `tests/unit/<module>.test.ts` for unit, `tests/integration/`
  for anything that touches a real database, `tests/e2e/` for Playwright.
- Tests must not write outside `mkdtempSync`-created tmp dirs. They must clean
  up in `afterEach`.
- `BAKLAVA_HOME` env var reroutes `~/.baklava` to a tmp dir for isolation.

## Toolchain

Both `bun` and `npm` are supported. The project commits both `bun.lock` and
`package-lock.json` so contributors can use either. Bun is faster locally;
CI uses `npm ci` for reproducibility.

## How to resume work

1. Run `bunx vitest run` to confirm the spine is still green.
2. Check git log for the latest commit's status.
3. The roadmap is in the README under "What's coming next."
4. The full design doc on the maintainer's machine has the 12-week plan.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool.
When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
