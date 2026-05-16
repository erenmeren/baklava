/* eslint-disable @typescript-eslint/no-require-imports */
// Seed sample data into the locally-running vector DBs + Neo4j so the
// Baklava workspaces show real content instead of empty lists.
//
// Run from the project root after `docker compose up -d`:
//
//   node seed/vector-and-graph.cjs
//
// Targets the default compose ports (qdrant:6333, weaviate:8080, chroma:8000,
// milvus:19530, neo4j:7687 with user neo4j/Baklava123!). Idempotent — wipes
// and recreates the demo collections / graph on each run.

// ─── helpers ───────────────────────────────────────────────────────────────
const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];
function randomVector(dim) {
  // Roughly L2-normalized
  const v = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / (norm || 1));
}
const TOPICS = ["llm", "rag", "vector-db", "embeddings", "fine-tuning", "agents", "evals", "infra"];
const AUTHORS = ["ava", "noah", "liam", "olivia", "elijah", "iris"];
const TITLES = [
  "Vector indexes explained",
  "HNSW vs IVF benchmarks",
  "Embedding model bake-off",
  "RAG pipelines in production",
  "Why your reranker matters",
  "Cost-efficient agents",
  "Building a Q&A bot in 90 min",
  "Choosing a vector store in 2026",
  "Hybrid search done right",
  "Filtering at million-vector scale",
];
const randTitle = (i) => `${pick(TITLES)} #${i}`;

// ─── qdrant ────────────────────────────────────────────────────────────────
async function seedQdrant() {
  const { QdrantClient } = require("@qdrant/js-client-rest");
  const client = new QdrantClient({ url: "http://localhost:6333", checkCompatibility: false });
  const COLL = [
    { name: "articles", dim: 64, count: 80 },
    { name: "products", dim: 32, count: 50 },
    { name: "images",   dim: 128, count: 30 },
  ];
  for (const c of COLL) {
    await client.deleteCollection(c.name).catch(() => {});
    await client.createCollection(c.name, {
      vectors: { size: c.dim, distance: "Cosine" },
    });
    const points = Array.from({ length: c.count }, (_, i) => ({
      id: i + 1,
      vector: randomVector(c.dim),
      payload: {
        title: randTitle(i),
        author: pick(AUTHORS),
        tags: [pick(TOPICS), pick(TOPICS)],
        score: +(Math.random() * 5).toFixed(2),
        published: Math.random() > 0.3,
      },
    }));
    await client.upsert(c.name, { wait: true, points });
    console.log(`  qdrant: ${c.name} (${c.count} points, dim=${c.dim})`);
  }
}

// ─── weaviate ──────────────────────────────────────────────────────────────
async function seedWeaviate() {
  // weaviate-client exports both CJS + ESM; require() picks the CJS bundle.
  const weaviate = require("weaviate-client").default;
  const client = await weaviate.connectToCustom({
    httpHost: "localhost", httpPort: 8080, httpSecure: false,
    grpcHost: "localhost", grpcPort: 50051, grpcSecure: false,
    skipInitChecks: true,
  });
  try {
    const CLASSES = [
      { name: "Article", dim: 64, count: 60 },
      { name: "Product", dim: 32, count: 40 },
    ];
    for (const c of CLASSES) {
      // Re-create from scratch
      const exists = await client.collections.exists(c.name).catch(() => false);
      if (exists) await client.collections.delete(c.name);
      await client.collections.create({
        name: c.name,
        vectorizers: weaviate.configure.vectors.selfProvided(),
        properties: [
          { name: "title",     dataType: "text"  },
          { name: "author",    dataType: "text"  },
          { name: "tag",       dataType: "text"  },
          { name: "score",     dataType: "number"},
          { name: "published", dataType: "boolean"},
        ],
      });
      const coll = client.collections.get(c.name);
      const objects = Array.from({ length: c.count }, (_, i) => ({
        properties: {
          title: randTitle(i),
          author: pick(AUTHORS),
          tag: pick(TOPICS),
          score: +(Math.random() * 5).toFixed(2),
          published: Math.random() > 0.3,
        },
        vectors: randomVector(c.dim),
      }));
      await coll.data.insertMany(objects);
      console.log(`  weaviate: ${c.name} (${c.count} objects, dim=${c.dim})`);
    }
  } finally {
    await client.close().catch(() => {});
  }
}

// ─── chroma ────────────────────────────────────────────────────────────────
async function seedChroma() {
  const { ChromaClient } = require("chromadb");
  const url = new URL("http://localhost:8000");
  const client = new ChromaClient({
    host: url.hostname,
    port: Number(url.port),
    ssl: url.protocol === "https:",
    tenant: "default_tenant",
    database: "default_database",
  });
  const COLL = [
    { name: "articles_chroma", dim: 64, count: 80 },
    { name: "support_docs",    dim: 32, count: 50 },
  ];
  for (const c of COLL) {
    try { await client.deleteCollection({ name: c.name }); } catch {}
    const coll = await client.createCollection({ name: c.name, metadata: { dim: c.dim, source: "baklava-seed" } });
    const ids = Array.from({ length: c.count }, (_, i) => `${c.name}-${i + 1}`);
    const embeddings = Array.from({ length: c.count }, () => randomVector(c.dim));
    const documents = Array.from({ length: c.count }, (_, i) =>
      `${randTitle(i)} — a ${pick(["short", "long", "draft"])} note about ${pick(TOPICS)}.`
    );
    const metadatas = Array.from({ length: c.count }, (_, i) => ({
      author: pick(AUTHORS),
      tag: pick(TOPICS),
      score: +(Math.random() * 5).toFixed(2),
      published: Math.random() > 0.3,
      idx: i,
    }));
    await coll.add({ ids, embeddings, documents, metadatas });
    console.log(`  chroma: ${c.name} (${c.count} docs, dim=${c.dim})`);
  }
}

// ─── milvus ────────────────────────────────────────────────────────────────
async function seedMilvus() {
  const { MilvusClient, DataType } = require("@zilliz/milvus2-sdk-node");
  const client = new MilvusClient({ address: "localhost:19530", timeout: 30000 });
  try {
    const COLL = [
      { name: "articles_m", dim: 64, count: 80 },
      { name: "products_m", dim: 32, count: 40 },
    ];
    for (const c of COLL) {
      const exists = await client.hasCollection({ collection_name: c.name });
      if (exists.value) {
        await client.releaseCollection({ collection_name: c.name }).catch(() => {});
        await client.dropCollection({ collection_name: c.name });
      }
      await client.createCollection({
        collection_name: c.name,
        fields: [
          { name: "id",        data_type: DataType.Int64,        is_primary_key: true, autoID: false },
          { name: "title",     data_type: DataType.VarChar,      max_length: 200 },
          { name: "author",    data_type: DataType.VarChar,      max_length: 64 },
          { name: "score",     data_type: DataType.Float },
          { name: "embedding", data_type: DataType.FloatVector,  dim: c.dim },
        ],
      });
      // Build an HNSW index so the collection is queryable after load
      await client.createIndex({
        collection_name: c.name,
        field_name: "embedding",
        index_name: "emb_idx",
        index_type: "HNSW",
        metric_type: "COSINE",
        params: { M: 16, efConstruction: 64 },
      });
      const rows = Array.from({ length: c.count }, (_, i) => ({
        id: i + 1,
        title: randTitle(i),
        author: pick(AUTHORS),
        score: +(Math.random() * 5).toFixed(2),
        embedding: randomVector(c.dim),
      }));
      await client.insert({ collection_name: c.name, data: rows });
      await client.flushSync({ collection_names: [c.name] });
      // Load so the collection is browsable in Baklava
      await client.loadCollectionSync({ collection_name: c.name });
      console.log(`  milvus: ${c.name} (${c.count} rows, dim=${c.dim}, loaded)`);
    }
  } finally {
    await client.closeConnection();
  }
}

// ─── neo4j ─────────────────────────────────────────────────────────────────
async function seedNeo4j() {
  const neo4j = require("neo4j-driver");
  const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Baklava123!"));
  const session = driver.session();
  try {
    // Wipe and reseed
    await session.run("MATCH (n) DETACH DELETE n");

    // 8 users, 12 movies, ratings, friendships, recommendations
    const users = ["Ava", "Noah", "Liam", "Olivia", "Elijah", "Iris", "Mateo", "Luna"];
    const movies = [
      { title: "Dune: Part Two",    year: 2024, genre: "scifi"   },
      { title: "Oppenheimer",       year: 2023, genre: "drama"   },
      { title: "Barbie",            year: 2023, genre: "comedy"  },
      { title: "The Batman",        year: 2022, genre: "action"  },
      { title: "Tenet",             year: 2020, genre: "scifi"   },
      { title: "Parasite",          year: 2019, genre: "thriller"},
      { title: "Inception",         year: 2010, genre: "scifi"   },
      { title: "Interstellar",      year: 2014, genre: "scifi"   },
      { title: "Get Out",           year: 2017, genre: "horror"  },
      { title: "Spirited Away",     year: 2001, genre: "anime"   },
      { title: "Whiplash",          year: 2014, genre: "drama"   },
      { title: "Mad Max: Fury Road",year: 2015, genre: "action"  },
    ];

    for (const u of users) {
      await session.run("CREATE (:User { name: $name, joined: date() })", { name: u });
    }
    for (const m of movies) {
      await session.run(
        "CREATE (:Movie { title: $title, year: $year, genre: $genre })",
        m
      );
    }
    // Random ratings
    for (const u of users) {
      const pickN = 3 + Math.floor(Math.random() * 4);
      const sampled = [...movies].sort(() => 0.5 - Math.random()).slice(0, pickN);
      for (const m of sampled) {
        const stars = 1 + Math.floor(Math.random() * 5);
        await session.run(
          `MATCH (u:User { name: $u }), (m:Movie { title: $t })
           CREATE (u)-[:RATED { stars: $stars, at: datetime() }]->(m)`,
          { u, t: m.title, stars }
        );
      }
    }
    // Friendships
    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        if (Math.random() < 0.4) {
          await session.run(
            `MATCH (a:User { name: $a }), (b:User { name: $b })
             CREATE (a)-[:FRIENDS_WITH { since: date() }]->(b)`,
            { a: users[i], b: users[j] }
          );
        }
      }
    }
    // Movie-to-movie similarity by shared genre
    for (let i = 0; i < movies.length; i++) {
      for (let j = i + 1; j < movies.length; j++) {
        if (movies[i].genre === movies[j].genre) {
          await session.run(
            `MATCH (a:Movie { title: $a }), (b:Movie { title: $b })
             CREATE (a)-[:SIMILAR_TO]->(b)`,
            { a: movies[i].title, b: movies[j].title }
          );
        }
      }
    }
    console.log(`  neo4j: ${users.length} users, ${movies.length} movies, ratings + friendships + similarity edges`);
  } finally {
    await session.close();
    await driver.close();
  }
}

(async () => {
  const tasks = [
    ["qdrant",   seedQdrant],
    ["weaviate", seedWeaviate],
    ["chroma",   seedChroma],
    ["milvus",   seedMilvus],
    ["neo4j",    seedNeo4j],
  ];
  for (const [name, fn] of tasks) {
    console.log(`> ${name}`);
    try { await fn(); }
    catch (e) { console.error(`  ${name} FAILED:`, e?.message || e); }
  }
  console.log("> Done.");
})();
