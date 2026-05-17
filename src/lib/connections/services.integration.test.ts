/**
 * Integration tests against the docker-compose stack. Gated by
 * BAKLAVA_INTEGRATION=1 — the vitest.config.ts only includes these
 * when that env var is set (the default `npm test` skips them).
 *
 * Each suite begins with a TCP reachability probe; if the service
 * isn't running on its expected localhost port, the whole suite is
 * skipped with a clear message rather than failing.
 *
 *   docker compose up -d
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import { reachable } from "@/test/integration-helpers";

// Credentials default to the compose defaults but can be overridden per
// environment (e.g. CI vs local) via env vars.
const PW = process.env.BAKLAVA_TEST_PW ?? "Baklava123!";
const PG_USER = process.env.BAKLAVA_PG_USER ?? "postgres";
const PG_PW = process.env.BAKLAVA_PG_PW ?? PW;
const MYSQL_USER = process.env.BAKLAVA_MYSQL_USER ?? "root";
const MYSQL_PW = process.env.BAKLAVA_MYSQL_PW ?? PW;

// ─────────────────────────────────────────────────────────────────────────────
// Postgres — including end-to-end verification that the `;`-injection
// rejection in requireNoStatementTerminator survives all the way through.
// ─────────────────────────────────────────────────────────────────────────────
describe("postgres", async () => {
  const up = await reachable("localhost", 5432);
  beforeAll(() => {
    if (!up) console.warn("[skip] postgres not reachable on localhost:5432");
  });

  it.skipIf(!up)("probePostgres returns a server version string", async () => {
    const { probePostgres } = await import("./postgres");
    const result = await probePostgres({
      host: "localhost",
      port: 5432,
      database: "postgres",
      user: PG_USER,
      password: PG_PW,
      ssl: false,
    });
    expect(typeof result.serverVersion).toBe("string");
    expect(result.serverVersion.length).toBeGreaterThan(0);
    expect(typeof result.currentUser).toBe("string");
    expect(typeof result.currentDatabase).toBe("string");
  });

  it.skipIf(!up)("listDatabases includes the default 'postgres' db", async () => {
    const { listDatabases } = await import("./postgres");
    const dbs = await listDatabases({
      host: "localhost",
      port: 5432,
      database: "postgres",
      user: PG_USER,
      password: PG_PW,
      ssl: false,
    });
    const names = dbs.map((d) => d.name);
    expect(names).toContain("postgres");
  });

  it.skipIf(!up)("createTable rejects a column type containing ';' end-to-end", async () => {
    const { createTable } = await import("./postgres");
    await expect(
      createTable(
        {
          host: "localhost",
          port: 5432,
          database: "postgres",
          user: "postgres",
          password: PW,
          ssl: false,
        },
        "postgres",
        {
          schema: "public",
          name: "test_sqli_guard",
          columns: [
            {
              name: "id",
              dataType: "integer; DROP TABLE pg_class",
              nullable: false,
              isPrimaryKey: true,
            },
          ],
        },
      ),
    ).rejects.toThrow(/cannot contain ';'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Redis — basic ping + set/get round-trip
// ─────────────────────────────────────────────────────────────────────────────
describe("redis", async () => {
  const up = await reachable("localhost", 6379);
  beforeAll(() => {
    if (!up) console.warn("[skip] redis not reachable on localhost:6379");
  });

  it.skipIf(!up)("probeRedis returns ok", async () => {
    const { probeRedis } = await import("./redis");
    const result = await probeRedis({
      host: "localhost",
      port: 6379,
      tls: false,
      database: 0,
    });
    expect(typeof result.version).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MongoDB
// ─────────────────────────────────────────────────────────────────────────────
describe("mongodb", async () => {
  const up = await reachable("localhost", 27017);
  beforeAll(() => {
    if (!up) console.warn("[skip] mongo not reachable on localhost:27017");
  });

  it.skipIf(!up)("probeMongo returns ok", async () => {
    const { probeMongo } = await import("./mongo");
    const result = await probeMongo({
      uri: "mongodb://localhost:27017",
    });
    expect(result).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kafka — must clean up ephemeral consumer groups (the project-driver-gotchas
// rule). After fetchMessages returns, the temp group must not linger.
// ─────────────────────────────────────────────────────────────────────────────
describe("kafka", async () => {
  const up = await reachable("localhost", 9092);
  beforeAll(() => {
    if (!up) console.warn("[skip] kafka not reachable on localhost:9092");
  });

  it.skipIf(!up)("probeKafka returns broker info", async () => {
    const { probeKafka } = await import("./kafka");
    const result = await probeKafka({
      clientId: "baklava-test",
      brokers: ["localhost:9092"],
      ssl: false,
    });
    expect(result.brokerCount).toBeGreaterThan(0);
    expect(Array.isArray(result.topics)).toBe(true);
  });

  it.skipIf(!up)("listTopics returns an array (may be empty)", async () => {
    const { listTopics } = await import("./kafka");
    const topics = await listTopics({
      clientId: "baklava-test",
      brokers: ["localhost:9092"],
      ssl: false,
    });
    expect(Array.isArray(topics)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Docker — host daemon, always available where docker compose is up
// ─────────────────────────────────────────────────────────────────────────────
describe("docker", () => {
  it("pingDocker via the host socket returns daemon info", async () => {
    const { pingDocker } = await import("./docker");
    const result = await pingDocker({
      mode: "socket",
      socketPath: "/var/run/docker.sock",
    });
    expect(typeof result.version).toBe("string");
    expect(typeof result.apiVersion).toBe("string");
    expect(typeof result.os).toBe("string");
    expect(typeof result.arch).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Qdrant
// ─────────────────────────────────────────────────────────────────────────────
describe("qdrant", async () => {
  const up = await reachable("localhost", 6333);
  beforeAll(() => {
    if (!up) console.warn("[skip] qdrant not reachable on localhost:6333");
  });

  it.skipIf(!up)("probeQdrant returns collection info", async () => {
    const { probeQdrant } = await import("./qdrant");
    const result = await probeQdrant({
      url: "http://localhost:6333",
    });
    expect(result).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Neo4j — verifies the Integer wrapper unwrap (project_driver_gotchas)
// ─────────────────────────────────────────────────────────────────────────────
describe("neo4j", async () => {
  const up = await reachable("localhost", 7687);
  beforeAll(() => {
    if (!up) console.warn("[skip] neo4j not reachable on localhost:7687");
  });

  it.skipIf(!up)("probeNeo4j returns server info with plain numbers (no Integer wrappers)", async () => {
    const { probeNeo4j } = await import("./neo4j");
    const result = await probeNeo4j({
      uri: "bolt://localhost:7687",
      user: "neo4j",
      password: PW,
    });
    expect(result).toBeTruthy();
    // The probe result should be JSON-serializable — if Integer wrappers
    // leaked through, JSON.stringify would emit {low,high} pairs.
    const json = JSON.stringify(result);
    expect(json).not.toContain('"low":');
    expect(json).not.toContain('"high":');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ClickHouse
// ─────────────────────────────────────────────────────────────────────────────
describe("clickhouse", async () => {
  const up = await reachable("localhost", 8123);
  beforeAll(() => {
    if (!up) console.warn("[skip] clickhouse not reachable on localhost:8123");
  });

  it.skipIf(!up)("probeClickhouse returns a version", async () => {
    const { probeClickhouse } = await import("./clickhouse");
    const result = await probeClickhouse({
      url: "http://localhost:8123",
      user: "default",
      password: "",
      database: "default",
    });
    expect(result.version).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SQL Server — verifies the May-16 current_user fix (T-SQL reserved word)
// ─────────────────────────────────────────────────────────────────────────────
describe("sqlserver", async () => {
  const up = await reachable("localhost", 1433);
  beforeAll(() => {
    if (!up) console.warn("[skip] sqlserver not reachable on localhost:1433");
  });

  it.skipIf(!up)("getSqlServerOverview succeeds (current_user fix)", async () => {
    const { getSqlServerOverview } = await import("./sqlserver");
    const result = await getSqlServerOverview({
      host: "localhost",
      port: 1433,
      database: "master",
      user: "sa",
      password: PW,
      encrypt: false,
      trustServerCertificate: true,
    });
    expect(result).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL
// ─────────────────────────────────────────────────────────────────────────────
describe("mysql", async () => {
  const up = await reachable("localhost", 3306);
  beforeAll(() => {
    if (!up) console.warn("[skip] mysql not reachable on localhost:3306");
  });

  it.skipIf(!up)("probeMysql returns a version", async () => {
    const { probeMysql } = await import("./mysql");
    const result = await probeMysql({
      host: "localhost",
      port: 3306,
      database: "demo",
      user: MYSQL_USER,
      password: MYSQL_PW,
      ssl: false,
    });
    expect(typeof result.version).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Etcd
// ─────────────────────────────────────────────────────────────────────────────
describe("etcd", async () => {
  const up = await reachable("localhost", 2379);
  beforeAll(() => {
    if (!up) console.warn("[skip] etcd not reachable on localhost:2379");
  });

  it.skipIf(!up)("probeEtcd returns ok", async () => {
    const { probeEtcd } = await import("./etcd");
    const result = await probeEtcd({
      hosts: ["http://localhost:2379"],
    });
    expect(result).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RabbitMQ
// ─────────────────────────────────────────────────────────────────────────────
describe("rabbitmq", async () => {
  const up = await reachable("localhost", 5672);
  beforeAll(() => {
    if (!up) console.warn("[skip] rabbit not reachable on localhost:5672");
  });

  it.skipIf(!up)("probeRabbit returns ok", async () => {
    const { probeRabbit } = await import("./rabbit");
    const result = await probeRabbit({
      host: "localhost",
      port: 5672,
      vhost: "/",
      user: "guest",
      password: "guest",
      tls: false,
    });
    expect(result).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NATS
// ─────────────────────────────────────────────────────────────────────────────
describe("nats", async () => {
  const up = await reachable("localhost", 4222);
  beforeAll(() => {
    if (!up) console.warn("[skip] nats not reachable on localhost:4222");
  });

  it.skipIf(!up)("probeNats returns server info", async () => {
    const { probeNats } = await import("./nats");
    const result = await probeNats({
      servers: ["nats://localhost:4222"],
    });
    expect(result).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Elastic
// ─────────────────────────────────────────────────────────────────────────────
describe("elastic", async () => {
  const up = await reachable("localhost", 9200);
  beforeAll(() => {
    if (!up) console.warn("[skip] elastic not reachable on localhost:9200");
  });

  it.skipIf(!up)("probeElastic returns cluster info", async () => {
    const { probeElastic } = await import("./elastic");
    const result = await probeElastic({
      nodes: ["http://localhost:9200"],
    });
    expect(result).toBeTruthy();
  });
});
