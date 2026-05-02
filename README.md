# baklava

> The unified developer console for the modern stack.
> Federated queries across Postgres, Mongo, Redis, Kafka, Docker, K8s — one resource graph, one query surface, one app.

**Status: pre-v0.1, growing fast.** The full headless query pipeline works
(layers 1 and 2). Layer 3 — the Next.js UI, REST API, CLI, and `--demo`
mode — just landed. Connect a Postgres or SQLite database, type a question
in plain English, and baklava will plan a federated SQL query, validate
it, fetch the data, join in DuckDB, and show one result table.

## Quickstart

Requires Node ≥ 20.

```sh
git clone https://github.com/erenmeren/baklava
cd baklava
npm install        # or: bun install

# 30-second tour: seed two SQLite databases and start the UI.
npm run demo       # or: tsx bin/baklava.ts --demo

# Or just start the UI against your own connections:
npm run baklava
```

Then open http://localhost:3000.

You'll need an Anthropic API key for the AI plan layer. Set it via:
- `export ANTHROPIC_API_KEY=sk-ant-...` before running, **or**
- the in-app Settings page (writes to `~/.baklava/config.json`, chmod 600).

## What this is

Every modern app is a graph of data services + infrastructure: Postgres,
Mongo, Redis, Kafka, RabbitMQ, S3, Docker, Kubernetes. Each one ships its
own GUI. Developers juggle 5+ tools to debug a single request.

baklava replaces that pile with one app. The unifying primitive is the
**resource graph**: every service exposes resources (tables, collections,
keys, topics, containers, pods, queues, buckets) and they all become
queryable rows in one DuckDB engine.

## What's shipped

```
lib/
  errors.ts         BaklavaError shape + 25-code registry
  config.ts         ~/.baklava/{connections,config,instance}.json + chmod 600
  duck.ts           per-query DuckDB Database (kills phantom-table + race + OOM)
  security.ts       Origin/Host/Token CSRF + DNS-rebinding gate
  pipeline.ts       runQuery() orchestrator
  api.ts            secured() route wrapper, structured ApiOk/ApiErr envelopes
  plugins.ts        plugin registry (sqlite, postgres)
  ai/
    prompt.ts       schema-aware prompt builder (snapshot-tested)
    plan.ts         Vercel ai SDK + @ai-sdk/anthropic + JSON parse
    retry.ts        one auto-retry on validator failure
    validate.ts     THE security model — three-layer SQL gate
  sources/
    types.ts        Plugin interface + FilterClause AST
    sqlite.ts       via better-sqlite3 (powers --demo)
    postgres.ts     via pg

app/                Next.js App Router
  layout.tsx
  page.tsx          NL input + result table (Client Component)
  api/v1/
    health/         GET status: {hasAiKey, connections}
    query/          POST {nl} → pipeline → JSON
    connections/    GET/POST/DELETE — connections.json CRUD
    config/         GET/POST/DELETE — anthropic_api_key

bin/baklava.ts      CLI: --demo, --port, version, doctor, --help
demo/seed-sqlite.ts bundles users + orders for the headline demo

tests/unit/         91 cases (errors, config, validate, sqlite, postgres,
                    prompt, plan, retry, security)
tests/integration/  16 cases (pipeline end-to-end with real SQLite +
                    real DuckDB + mocked AI)
.github/workflows/ci.yml   Node 20 + 22

Total: 107 tests, all green.
```

## Why the validator matters

The AI translates natural language into SQL. The validator decides whether
that SQL is safe to execute. This is the security model: if it leaks, the
AI can read arbitrary files (`SELECT * FROM read_json_auto('/etc/passwd')`),
exfiltrate data from connections it wasn't asked to use (phantom-table
attack), or escape DuckDB's sandbox via `ATTACH`/`INSTALL`/`LOAD`.

The validator is a three-layer gate:

1. **Parse** the SQL with `node-sql-parser` (Postgres dialect). Reject if
   it doesn't parse, has multiple statements, or isn't rooted in `SELECT`.
2. **Walk the AST**. Reject any node whose type is in the forbidden list
   (DML, DDL, transactions, `ATTACH`, `PRAGMA`, `INSTALL`, `LOAD`, `COPY`,
   `CALL`, `EXPORT`, `IMPORT`). Reject any `FROM` entry that's a function
   call instead of a table reference. Reject any `read_*` / `attach` /
   `load` / `install` / `copy` function call anywhere.
3. **Bind against a fresh DuckDB instance** that contains only the
   declared sources as empty stub tables. Run `EXPLAIN` against the SQL.
   If DuckDB can't bind the query (because it references an undeclared
   table or column), reject.

Phantom tables, hallucinated columns, and DuckDB-specific file-read
primitives all die at layer 3.

## Local-first guarantees

- All data is stored under `~/.baklava/` with `chmod 600` enforcement on
  files containing credentials.
- The web server binds to `127.0.0.1` only.
- Every API route requires a per-instance token (`~/.baklava/instance.key`,
  chmod 600), validated in constant time. Defeats DNS rebinding + CSRF.
- `Origin` + `Host` headers are validated against `localhost:<port>`.
- The only data that leaves the machine is your natural-language question
  and the schema (table names + column names + types) of your connected
  sources, sent to Anthropic for plan generation. Row data is never sent.

## What's coming next

1. **shadcn/ui polish** — the page is plain CSS for now; shadcn drops in
   to make the UI match the Linear-for-DBAs taste bar.
2. **First-run wizard** at `/welcome` — 3-step onboarding (connection →
   AI key → first query).
3. **Connections + Settings pages** — UI for the existing API routes.
4. **Plugin SDK extraction** as `@baklava/plugin-sdk` — third-party
   plugins (Mongo, Redis, Kafka, Docker, K8s, RabbitMQ, S3).
5. **One Playwright E2E** that drives the `--demo` happy path.
6. **Production binary path** — proper `next build` + bundled CLI so
   `npx baklava` works without a clone.
7. **30-prompt LLM eval suite** for the validator.

The full design doc lives at
`~/.gstack/projects/baklava/eren-main-design-20260502-214731.md`
on the maintainer's machine.

## License

MIT.
