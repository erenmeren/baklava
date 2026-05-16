# Seed scripts

Quick demo data for the techs that Baklava integrates with. Run after
`docker compose up -d` (or after pointing at your own instances).

| Script | Targets | What it creates |
|---|---|---|
| [`sqlite.sh`](#sqlitesh) | SQLite (file) | Sample blog schema (users / posts / events) with indexes, a view, a trigger |
| [`vector-and-graph.cjs`](#vector-and-graphcjs) | Qdrant, Weaviate, Chroma, Milvus, Neo4j | Demo collections with random vectors + a small movies graph |

For Kafka there is also `/tmp/seed-kafka.cjs` referenced earlier in
session notes — kept in `/tmp` rather than checked in because Kafka's
demo data is throwaway (topics + groups specific to one container run).
You can re-create it from the [original snippet](#kafka-seed-snippet) below.

---

## `sqlite.sh`

```bash
bash seed/sqlite.sh                          # writes /tmp/baklava-data/demo.sqlite
bash seed/sqlite.sh /path/to/other.sqlite    # custom path
```

Creates:
- **`users`** (5 rows) — `id, email, name, status, created_at`, `idx_users_status`
- **`posts`** (5 rows) — `id, user_id, title, body, published, view_count, created_at`, FK to `users`, partial index on published
- **`events`** (5 rows) — `id, type, payload, ts`
- **`active_users`** view — `WHERE status = 'active'`
- **`posts_audit`** trigger — appends a `post.created` event after every insert

After running, point Baklava's SQLite connection at the file:

| Field | Value |
|---|---|
| File path | `/tmp/baklava-data/demo.sqlite` |
| Read-only | off |

Then the Tables list shows 3 tables + 1 view, with row counts and per-table column / index / trigger introspection in the detail view.

---

## `vector-and-graph.cjs`

```bash
npm install                                   # if you haven't yet
node seed/vector-and-graph.cjs                # seeds everything
```

**Idempotent** — wipes and recreates the demo collections / graph on each run, so it's safe to re-run after iterating.

Targets the default compose ports. Override the addresses by editing the constants at the top of the script if you need to.

### Qdrant — 3 collections at `http://localhost:6333`

| Collection | Vectors | Dim | Distance | Payload fields |
|---|---:|---:|---|---|
| `articles` | 80 | 64 | Cosine | `title`, `author`, `tags[]`, `score`, `published` |
| `products` | 50 | 32 | Cosine | same |
| `images` | 30 | 128 | Cosine | same |

In Baklava: open the Qdrant overview to see the per-collection vector-count bar; click a collection to inspect schema, scroll the sample points, and view the payload of any point via the Sheet drawer.

### Weaviate — 2 classes at `http://localhost:8080`

| Class | Objects | Dim | Vectorizer | Properties |
|---|---:|---:|---|---|
| `Article` | 60 | 64 | self-provided | `title`, `author`, `tag`, `score`, `published` |
| `Product` | 40 | 32 | self-provided | same |

Vectors are L2-normalized random floats (no external embedding service needed). In Baklava: collections list shows object counts with severity bars; collection detail shows the property schema and a sample of objects.

### Chroma — 2 collections at `http://localhost:8000`

| Collection | Documents | Dim | Metadata fields |
|---|---:|---:|---|
| `articles_chroma` | 80 | 64 | `author`, `tag`, `score`, `published`, `idx` |
| `support_docs` | 50 | 32 | same |

Tenant / database: `default_tenant` / `default_database`. Each document also has a short generated text body so the Sample tab is interesting to read.

### Milvus — 2 collections at `localhost:19530`

| Collection | Rows | Dim | Index | Loaded? |
|---|---:|---:|---|:---:|
| `articles_m` | 80 | 64 | HNSW (M=16, ef=64), COSINE | ✓ |
| `products_m` | 40 | 32 | HNSW (M=16, ef=64), COSINE | ✓ |

Schema: `id` (Int64 PK) · `title` (VarChar 200) · `author` (VarChar 64) · `score` (Float) · `embedding` (FloatVector).

The script calls `loadCollectionSync` after insert + flush so the Sample tab works immediately. If you `releaseCollection` them later, Baklava will show the friendly "load this collection first" notice instead of a hard error.

### Neo4j — small movies graph at `bolt://localhost:7687`

User: `neo4j` / password: `Baklava123!`

- **8 Users** — Ava, Noah, Liam, Olivia, Elijah, Iris, Mateo, Luna
- **12 Movies** — Dune Part Two, Oppenheimer, Barbie, The Batman, Tenet, Parasite, Inception, Interstellar, Get Out, Spirited Away, Whiplash, Mad Max: Fury Road (with `year` + `genre`)
- **`RATED`** edges — each user rates 3–7 random movies with 1–5 `stars`
- **`FRIENDS_WITH`** — random friendships between users (~40% pair probability)
- **`SIMILAR_TO`** — between movies that share a genre

In the Database detail page, switch to the **Cypher** tab and try:

```cypher
// Top-rated movies overall
MATCH (u:User)-[r:RATED]->(m:Movie)
RETURN m.title, m.genre, avg(r.stars) AS rating, count(*) AS votes
ORDER BY rating DESC, votes DESC
LIMIT 10
```

```cypher
// "Friends of friends who liked the same movie"
MATCH (me:User { name: "Ava" })-[:FRIENDS_WITH]-(friend:User)-[:RATED]->(m:Movie)
WHERE NOT EXISTS { (me)-[:RATED]->(m) }
RETURN m.title, count(friend) AS recommenders
ORDER BY recommenders DESC
LIMIT 5
```

```cypher
// Genre clusters via SIMILAR_TO
MATCH (m:Movie)-[:SIMILAR_TO]-(n:Movie)
RETURN m.genre, collect(DISTINCT m.title)[..5] AS sample, count(DISTINCT m) AS total
ORDER BY total DESC
```

The result drawer expands any Node / Relationship cell into a full property view — handy for inspecting individual rated edges.

---

## Kafka seed snippet

The Kafka seeder lived in `/tmp/seed-kafka.cjs` during the session that
wrote it. To rebuild it for your container, the shape is:

```js
// /tmp/seed-kafka.cjs — run with:
//   NODE_PATH=/Users/eren/Projects/baklava/node_modules node /tmp/seed-kafka.cjs
const { Kafka } = require("kafkajs");

const kafka = new Kafka({ clientId: "baklava-seed", brokers: ["localhost:9092"] });
const admin = kafka.admin();
const producer = kafka.producer({ allowAutoTopicCreation: false });

const TOPICS = [
  { name: "orders",            partitions: 6, count: 800 },
  { name: "user-events",       partitions: 3, count: 400 },
  { name: "payments",          partitions: 4, count: 250 },
  { name: "audit-log",         partitions: 12, count: 180 },
  { name: "notifications",     partitions: 2, count: 30  },
  { name: "metrics-snapshot",  partitions: 8, count: 600 },
  { name: "dead-letter-queue", partitions: 1, count: 0   },
];

// 1) await admin.createTopics({ topics: TOPICS.map(...), waitForLeaders: true });
// 2) for each topic with count > 0: producer.send({ messages: [...JSON payloads...] });
// 3) For each consumer group you want with lag, use kafka-console-consumer.sh
//    inside the container (NOT admin.setOffsets — it leaves phantom members):
//
//    docker exec baklava-kafka-1 /opt/kafka/bin/kafka-console-consumer.sh \
//      --bootstrap-server localhost:9092 \
//      --topic orders --group orders-processor \
//      --from-beginning --max-messages 240 --timeout-ms 30000
```

If you want this back as a proper checked-in script, open an issue / PR and we'll productionize it.
