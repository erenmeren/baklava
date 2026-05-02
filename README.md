# baklava

> The unified developer console for the modern stack.
> Federated queries across Postgres, Mongo, Redis, Kafka, Docker, K8s — one resource graph, one query surface, one app.

**Status: pre-v0.1.** This repo currently contains the security spine (config, errors, DuckDB wrapper, AI plan validator) plus its tests. The query UI, AI integration, source connectors, and `--demo` mode are next.

---

## What this is

Every modern app is a graph of data services + infrastructure: Postgres, Mongo, Redis, Kafka, RabbitMQ, S3, Docker, Kubernetes. Each one ships its own GUI. Developers juggle 5+ tools to debug a single request.

baklava replaces that pile with one app. Type a question in plain English. baklava plans a federated query, fetches the data from each declared source, joins them in DuckDB, and shows one result table.

The unifying primitive is the **resource graph**: every service exposes resources (tables, collections, keys, topics, containers, pods, queues, buckets) and they all become queryable rows in one engine.

## What's in this commit

```
lib/
  errors.ts        — BaklavaError shape + code registry
  config.ts        — ~/.baklava/{connections,config}.json with chmod 600 + schema_version
  duck.ts          — per-query DuckDB instance (kills phantom-table + concurrency + OOM risks)
  ai/
    validate.ts    — node-sql-parser allowlist + DuckDB EXPLAIN check (the security model)

tests/unit/
  errors.test.ts   — 10 cases
  config.test.ts   — 12 cases (incl. POSIX permission enforcement)
  validate.test.ts — 25 cases (incl. read_json_auto, ATTACH, PRAGMA, DML, phantom tables)

.github/workflows/ci.yml — typecheck + test on Node 20 + 22
```

47 tests, all passing.

## Why the validator matters

The AI translates natural language into SQL. The validator decides whether that SQL is safe to execute. This is the security model: if it leaks, the AI can read arbitrary files (`SELECT * FROM read_json_auto('/etc/passwd')`), exfiltrate data from connections it wasn't asked to use (phantom-table attack), or escape DuckDB's sandbox via `ATTACH`/`INSTALL`/`LOAD`.

The validator is a three-layer gate:

1. **Parse** the SQL with `node-sql-parser` (Postgres dialect). Reject if it doesn't parse, has multiple statements, or isn't rooted in `SELECT`.
2. **Walk the AST**. Reject any node whose type is in the forbidden list (DML, DDL, transactions, `ATTACH`, `PRAGMA`, `INSTALL`, `LOAD`, `COPY`, `CALL`, `EXPORT`, `IMPORT`). Reject any `FROM` entry that's a function call instead of a table reference. Reject any `read_*` / `attach` / `load` / `install` / `copy` function call anywhere.
3. **Bind against a fresh DuckDB instance** that contains only the declared sources as empty stub tables. Run `EXPLAIN` against the SQL. If DuckDB can't bind the query (because it references an undeclared table or column), reject.

Phantom tables, hallucinated columns, and DuckDB-specific file-read primitives all die at layer 3.

## Local development

Requires Node ≥ 20. `bun` works for installs; `npm` works too.

```sh
git clone https://github.com/erenmeren/baklava
cd baklava
npm install        # or: bun install
npm test           # 47 tests
npm run typecheck
```

## What's coming next

In rough order:

1. `lib/sources/postgres.ts` + `lib/sources/sqlite.ts` — first two source connectors
2. `lib/ai/prompt.ts` + `lib/ai/plan.ts` + `lib/ai/retry.ts` — Vercel `ai` SDK + `@ai-sdk/anthropic`, structured plan output, auto-retry on validator fail
3. `lib/pipeline.ts` — the orchestrator: NL → schemas → plan → validate → fetch → register → execute → JSON
4. `lib/security.ts` — Origin/Host/token middleware (DNS rebinding + CSRF)
5. Next.js App Router scaffold + `app/page.tsx`, `app/welcome/page.tsx`, `app/connections/page.tsx`, `app/settings/page.tsx`, `app/api/v1/*`
6. `bin/baklava.ts` — CLI: `--demo`, `--port`, `version`, `doctor`
7. `demo/seed-sqlite.ts` — bundled SQLite pair for the headline `npx baklava --demo` flow
8. Plugin SDK extraction (`@baklava/plugin-sdk`)

The full design doc lives at `~/.gstack/projects/baklava/eren-main-design-20260502-214731.md` (local — not in this repo).

## License

MIT.
