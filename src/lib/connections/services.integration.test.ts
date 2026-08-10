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
// MySQL — Task 13's constraint / foreign-key introspection against the
// compose service and `seed/mysql.sh`'s schema. The seed creates
// `order_items(order_id, product_id)` with a composite-ordered FK to
// `orders(id)`, which is the only place the ordinal-sorting branch of
// groupForeignKeyRows is exercised against a real server.
// ─────────────────────────────────────────────────────────────────────────────
describe("mysql", async () => {
  const up = await reachable("localhost", 3306);
  beforeAll(() => {
    if (!up) console.warn("[skip] mysql not reachable on localhost:3306");
  });

  const cfg = {
    host: "localhost",
    port: 3306,
    database: "demo",
    user: process.env.BAKLAVA_MYSQL_USER ?? "root",
    password: process.env.BAKLAVA_MYSQL_PW ?? PW,
    ssl: false,
  };

  it.skipIf(!up)("listForeignKeys returns the seeded key with its columns in order", async () => {
    const { listForeignKeys } = await import("./mysql-constraints");
    const fks = await listForeignKeys(cfg, "demo", "order_items");
    const toOrders = fks.find((f) => f.refTable === "orders");
    expect(toOrders).toBeTruthy();
    expect(toOrders!.columns).toEqual(["order_id"]);
    expect(toOrders!.refColumns).toEqual(["id"]);
    expect(toOrders!.refSchema).toBe("demo");
  });

  it.skipIf(!up)("listConstraints includes the primary key", async () => {
    const { listConstraints } = await import("./mysql-constraints");
    const cs = await listConstraints(cfg, "demo", "orders");
    expect(cs.some((c) => c.type === "PRIMARY KEY")).toBe(true);
  });

  it.skipIf(!up)("rejects a hostile database name before connecting", async () => {
    const { listConstraints } = await import("./mysql-constraints");
    await expect(
      listConstraints(cfg, "demo`; DROP DATABASE demo; --", "orders"),
    ).rejects.toThrow(/database name/i);
  });
});
