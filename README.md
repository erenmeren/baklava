# Baklava

**One console for your whole backend.**

Baklava is a free, open-source dashboard for the infrastructure you already run — Docker, databases, Kafka, Kubernetes, Redis, object storage, and more. Each one gets a workspace modeled on the dedicated app you'd normally reach for, so you stop juggling Docker Desktop, pgAdmin, kafka-ui, RedisInsight, an S3 browser, and a dozen browser tabs. It all lives in one place, on your machine.

![Baklava home — every technology in one grid](docs/images/02-home.png)

---

## Get started in two minutes

You need [Node.js](https://nodejs.org) 20+ and (optionally) [Docker](https://www.docker.com/products/docker-desktop/).

```bash
npm install
npm run dev
```

Open **http://localhost:3000**.

The first time you open Baklava, it asks you to **create a password**. There's no default — you pick one, and it's stored (hashed) only on your machine. Any password works; there are no length rules.

![Create a password on first run](docs/images/01-setup.png)

That's it. Docker works immediately. For everything else, you add a connection in the UI.

---

## How to use it

**1. Pick a technology** from the home grid and add a connection. You fill in the host, port, and credentials, then hit **Test** — a successful test saves it. (Docker needs nothing; it uses your local Docker automatically.)

**2. Open the connection** to land in a full workspace — sidebar, tables, detail views — shaped like the tool you already know.

For example, the **Docker** workspace is a Portainer-grade view of your containers, images, volumes, networks, and stacks, with logs, stats, and a real terminal one click away:

![Docker workspace — containers, images, stacks, and more](docs/images/04-docker.png)

And the **PostgreSQL** workspace feels like pgAdmin — a live health dashboard, a schema tree, table browsers, and a SQL editor with autocomplete:

![PostgreSQL workspace — live dashboard and schema tree](docs/images/05-postgres.png)

**3. Jump anywhere with ⌘K.** Press **⌘K / Ctrl+K** (or the search pill in the header) to hop to any connection, section, or object, or to run quick actions like adding a connection or toggling the theme.

![The ⌘K command palette](docs/images/03-palette.png)

---

## What's integrated

| Category | Technologies | Modeled on |
|---|---|---|
| **Runtime** | Docker | Docker Desktop / Portainer |
| **Database** | PostgreSQL · MySQL · SQL Server · MongoDB | pgAdmin · phpMyAdmin · SSMS · Compass |
| **Streaming** | Kafka | kafka-ui |
| **Orchestration** | Kubernetes | k9s |
| **Cache** | Redis | RedisInsight |
| **Vector** | Qdrant | — |
| **Object storage** | Cloudflare R2 · MinIO · Amazon S3 | an S3 file browser |

Each workspace gives you the everyday operations you'd expect: browse and edit data, run queries, watch logs and metrics, manage objects, and perform the destructive actions (drop, delete, prune) behind clear confirmations.

---

## Your data stays on your machine

Baklava has no cloud, no account, and no telemetry. Connections are saved to `~/.baklava/connections.json` (readable only by you) so they survive restarts. Set `BAKLAVA_DATA_DIR` to store them somewhere else.

Connection passwords are kept in plain text on disk — the same approach as `~/.kube/config`, `~/.docker/config.json`, or `~/.aws/credentials`. Keep the file private.

### The password gate

Because Baklava can read every stored credential and run destructive queries, it sits behind a **single shared password** (one password, no usernames) whenever it's reachable over a network.

- **You create the password on first run** — there is no default to forget or leak.
- **Change it** anytime in **Settings → Security**, and use **Lock console** in the header to sign out.
- **Turn the gate off** in **Settings → Security** if you're on a trusted machine and the prompt is just friction. Leave it **on** for anything exposed to a network.
- Prefer to set it up front? Start with `BAKLAVA_INITIAL_PASSWORD='your-password' npm run dev` to skip the create-password screen.

The password is hashed (scrypt) and stored in `~/.baklava/auth.json`. It never leaves the server.

---

## Want demo data to explore?

A `compose.yaml` at the project root spins up Postgres, Kafka, and SQL Server so you have something real to click through:

```bash
docker compose up -d           # start everything
bash seed/all.sh               # fill it with demo data
docker compose down -v         # stop and wipe when you're done
```

This gives you a 250-row storefront in Postgres, a keyed Kafka stream, and a labelled Docker stack. Then add these connections in the UI (all local, throwaway):

| Tech | Host | Port | User | Password | Notes |
|---|---|---:|---|---|---|
| **Docker** | — | — | — | — | detected automatically |
| **PostgreSQL** | localhost | 5432 | `postgres` | `Baklava123!` | database `demo` |
| **Kafka** | — | — | — | — | broker `localhost:9092` |
| **SQL Server** | localhost | 1433 | `sa` | `Baklava123!` | encrypt on, trust server cert |

See [`seed/README.md`](seed/README.md) for exactly what each script creates.

Pointing at a service you already run? Any standard connection works — for example:

```bash
docker run -p 6379:6379 redis:latest          # Redis
docker run -p 27017:27017 mongo:latest        # MongoDB
docker run -p 6333:6333 qdrant/qdrant         # Qdrant
```

For Kubernetes, Baklava reads your existing `~/.kube/config` — no setup needed.

---

## Contributing

Baklava is built with Next.js 16, React 19, and TypeScript. Want to run it from source, understand the architecture, or add a new technology? See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## License

Open source — license to be added.
