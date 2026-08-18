# Seed scripts

Demo data for the five techs these scripts cover. Run after
`docker compose up -d` (the SQL Server / Postgres / MySQL / Kafka
services need to be healthy first).

```bash
bash seed/all.sh                 # run everything
bash seed/postgres.sh            # just one
```

Every script is **idempotent** — re-running drops and recreates the
demo objects, so it's safe to iterate.

| Script | Targets | What it creates |
|---|---|---|
| [`docker.sh`](#dockersh) | Docker daemon | 4 images, a `demo` stack (nginx + busybox + alpine), a network, a volume |
| [`postgres.sh`](#postgressh) | Postgres | `shop` + `analytics` schemas, 4 tables, 2 views, ~250 rows |
| [`mysql.sh`](#mysqlsh) | MySQL | `demo` database, 4 tables, 1 view, 3 foreign keys, 2 check constraints |
| [`kafka.sh`](#kafkash) | Kafka | 5 topics, 27 keyed messages, a consumer group with committed offsets |
| [`sqlserver.sh`](#sqlserversh) | SQL Server | `BaklavaDemo` database with one of every SSMS-style object kind |

---

## `docker.sh`

```bash
bash seed/docker.sh
```

Pulls `nginx:alpine`, `busybox`, `alpine:3.20`, `hello-world`. Creates a
`baklava-demo-net` network and a `baklava-demo-data` volume, then starts
three labelled containers as the `demo` stack:

- `baklava-demo-web` — nginx on host port `18080`
- `baklava-demo-cache` — busybox holding the demo volume
- `baklava-demo-worker` — alpine emitting a tick every 5s (good for logs/stats)

All three carry `baklava.stack.name=demo` so the Docker workspace
**Stacks** tab groups them. Re-run anytime to reset.

---

## `postgres.sh`

```bash
bash seed/postgres.sh
```

Connects via local `psql` if available, otherwise `docker compose exec`.
Default credentials match `compose.yaml`. To target a remote instance
override `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`.

Creates inside the `demo` database:

- **`shop` schema**
  - `customers` (10 rows) — id, email, name, country, vip
  - `products` (10 rows) — sku, category, price_cents, stock
  - `orders` (60 rows) — references customers, has an `order_status` enum
  - `order_items` (~180 rows) — references orders and products
  - indexes on FKs and common lookups
- **`analytics` schema**
  - `daily_revenue` view — aggregates orders by day
  - `top_customers` view — lifetime value with vip flag

In the Baklava UI: PostgreSQL workspace → expand `demo` → `shop` /
`analytics`. The overview dashboard shows the new tables + queries.

---

## `mysql.sh`

```bash
bash seed/mysql.sh
```

Connects via local `mysql` if available, otherwise `docker compose exec`.
Default credentials match `compose.yaml`. To target a remote instance
override `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` /
`MYSQL_DATABASE`.

MySQL has no schema layer, so everything lives in the `demo` database:

- `customers` (5 rows) — `AUTO_INCREMENT` PK, a `UNIQUE` email, column
  comments, a secondary index on `country`
- `products` (5 rows) — `UNIQUE` sku, index on `category`, a `CHECK`
  constraint on price
- `orders` (5 rows) — an `ENUM` status column, FK to `customers`
- `order_items` (6 rows) — composite `(order_id, line_no)` PK, two FKs,
  a `CHECK` constraint
- `top_customers` view — lifetime value with the vip flag

Chosen so every tab of the table workspace has something to show:
Structure (comments, defaults, `AUTO_INCREMENT`), Indexes, Constraints,
Foreign keys, and an `ENUM` that exercises the row form's type detection.

In the Baklava UI: MySQL workspace → expand `demo`.

---

## `kafka.sh`

```bash
bash seed/kafka.sh
```

Connects via `docker compose exec` to the kafka container's bundled
shell scripts. Creates these topics:

| Topic | Partitions | Sample payload |
|---|---:|---|
| `events` | 6 | `{"type":"signup","userId":101,"plan":"free"}` |
| `orders` | 3 | `{"orderId":1001,"customerId":42,"total":189.00,"status":"placed"}` |
| `audit` | 1 | `{"actor":"api-gateway","action":"deploy","version":"2.14.0"}` |
| `notifications` | 4 | `{"channel":"email","template":"welcome","to":"…"}` |
| `metrics` | 2 | `{"cpu":0.42,"mem":0.61,"loadavg":1.2}` |

Messages are **keyed** (`user-101`, `order-1001`, `host-web-01`, …) so
they spread deterministically across partitions — useful for testing the
partition heatmap. The script also briefly consumes from `orders` with
group `baklava-demo` so the Consumer Groups page shows lag/state on the
first visit.

In the Baklava UI: Kafka workspace → Topics for the message browser,
Consumer Groups for the demo group, Brokers for cluster health.

---

## `sqlserver.sh`

```bash
bash seed/sqlserver.sh
```

Connects via `docker compose exec` to the sqlserver container's bundled
`sqlcmd`. Drops + recreates the `BaklavaDemo` database, then populates
it with **one of every SSMS-style schema object** so every group in the
sidebar lights up:

- **`shop` schema**: `Customers` (10), `Products` (10), `Orders` (60),
  `OrderItems` (~180)
- **`analytics` schema**: `DailyRevenue` view
- **Programmability**
  - Procedure: `shop.GetCustomerOrders(@CustomerId BIGINT)`
  - Scalar function: `shop.FormatMoney(@Cents BIGINT) RETURNS NVARCHAR(20)`
  - Trigger: `shop.trg_Orders_StampStatus` on `shop.Orders` (AFTER UPDATE)
  - Sequence: `shop.OrderNumberSeq` (BIGINT, starts at 1000, caches 50)
- **Types**
  - Alias: `shop.EmailAddress` (`NVARCHAR(254) NOT NULL`)
  - Alias: `shop.MoneyCents` (`BIGINT NOT NULL`) — used as a column type
  - Table type: `shop.OrderLineTableType` — table-valued parameter shape
- **Synonym**: `shop.AllCustomers` → `shop.Customers`

In the Baklava UI: SQL Server workspace → expand `BaklavaDemo` →
`shop`. Every category (Tables / Views / Procedures / Functions /
Sequences / User-Defined Types / Table Types / Synonyms / Triggers)
will have at least one entry, and the `+` button on each group opens
the corresponding create dialog.

The overview dashboard surfaces the demo database in the **Databases**
panel and the seed-induced traffic (the `INSERT … SELECT` runs) often
shows up in the **Top queries** panel.

## `kubernetes.sh`

Seeds the local k3s cluster (`docker compose up -d k3s`) with a `demo`
namespace holding one of nearly every kind the workspace lists: a two-container
Deployment, a Service, ConfigMap, Secret, StatefulSet, DaemonSet, Job, CronJob,
Ingress and PVC — plus a deliberately-broken pod (`broken-image`) so the Events
screen and `describe` have a real failure to show.

```bash
docker compose up -d k3s
bash seed/kubernetes.sh
```

Needs `kubectl` on PATH; `KUBECONFIG` defaults to `.kube/kubeconfig.yaml`,
which the compose service writes. Both the driver integration tests
(`npm run test:integration`) and `e2e/kubernetes-workspace.spec.ts` expect this
seed.
