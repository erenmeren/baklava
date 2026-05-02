import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runQuery, type RegisteredSource } from "../../lib/pipeline.js";
import { sqlitePlugin } from "../../lib/sources/sqlite.js";
import type { PlanGenerator } from "../../lib/ai/plan.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "baklava-pipeline-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function seedSource(
  filename: string,
  ddl: string,
  connectionName: string
): Promise<RegisteredSource> {
  const path = join(tmpDir, filename);
  const seed = new Database(path);
  seed.exec(ddl);
  seed.close();
  const handle = await sqlitePlugin.connect({
    name: connectionName,
    plugin: "sqlite",
    config: { path },
  });
  const schemas = await sqlitePlugin.listTables(handle);
  return {
    connectionName,
    pluginName: "sqlite",
    plugin: sqlitePlugin,
    handle,
    schemas,
  };
}

function fixedGen(jsonResponse: object): PlanGenerator {
  return async () => JSON.stringify(jsonResponse);
}

describe("pipeline.runQuery — single-source happy path", () => {
  it("plans → fetches → executes → returns rows", async () => {
    const src = await seedSource(
      "app.db",
      `
        CREATE TABLE users (id INTEGER, email TEXT, plan_tier TEXT);
        INSERT INTO users VALUES (1,'a@x.com','pro'),(2,'b@x.com','free'),(3,'c@x.com','pro');
      `,
      "app"
    );
    try {
      const plan = {
        plan_english: "Select pro users.",
        sources: [{ connection: "app", table: "users" }],
        sql: 'SELECT id, email FROM app__users WHERE plan_tier = \'pro\'',
      };
      const result = await runQuery({
        nl: "show me pro users",
        sources: [src],
        generator: fixedGen(plan),
      });
      expect(result.attempts).toBe(1);
      expect(result.columns).toEqual(["id", "email"]);
      expect(result.rows).toHaveLength(2);
      expect(result.rows.map((r) => r[1]).sort()).toEqual(["a@x.com", "c@x.com"]);
      expect(result.timingMs.total).toBeGreaterThanOrEqual(0);
      expect(result.truncations).toEqual([]);
    } finally {
      await sqlitePlugin.disconnect(src.handle as never);
    }
  });
});

describe("pipeline.runQuery — cross-source JOIN", () => {
  it("joins rows from two SQLite sources via DuckDB", async () => {
    const usersSrc = await seedSource(
      "app.db",
      `
        CREATE TABLE users (id INTEGER, email TEXT, plan_tier TEXT);
        INSERT INTO users VALUES (1,'a@x.com','pro'),(2,'b@x.com','free'),(3,'c@x.com','pro');
      `,
      "app"
    );
    const ordersSrc = await seedSource(
      "events.db",
      `
        CREATE TABLE orders (id INTEGER, user_id INTEGER, status TEXT);
        INSERT INTO orders VALUES (101,1,'paid'),(102,2,'abandoned'),(103,1,'paid'),(104,3,'paid');
      `,
      "events"
    );

    try {
      const plan = {
        plan_english: "Pro users and their paid orders.",
        sources: [
          { connection: "app", table: "users" },
          { connection: "events", table: "orders" },
        ],
        sql: `SELECT u.email, o.id AS order_id
              FROM app__users u
              JOIN events__orders o ON u.id = o.user_id
              WHERE u.plan_tier = 'pro' AND o.status = 'paid'
              ORDER BY o.id`,
      };

      const result = await runQuery({
        nl: "what did pro users pay for",
        sources: [usersSrc, ordersSrc],
        generator: fixedGen(plan),
      });

      expect(result.columns).toEqual(["email", "order_id"]);
      expect(result.rows).toEqual([
        ["a@x.com", 101],
        ["a@x.com", 103],
        ["c@x.com", 104],
      ]);
    } finally {
      await sqlitePlugin.disconnect(usersSrc.handle as never);
      await sqlitePlugin.disconnect(ordersSrc.handle as never);
    }
  });
});

describe("pipeline.runQuery — security gate", () => {
  it("rejects an AI plan that references a phantom table", async () => {
    const src = await seedSource(
      "app.db",
      `CREATE TABLE users (id INTEGER); INSERT INTO users VALUES (1);`,
      "app"
    );
    try {
      // The generator returns the same bad plan twice → both validations fail → throws.
      const phantomPlan = {
        plan_english: "Read secrets.",
        sources: [{ connection: "app", table: "users" }],
        sql: "SELECT * FROM admin_audit",
      };
      await expect(
        runQuery({
          nl: "read everything",
          sources: [src],
          generator: fixedGen(phantomPlan),
        })
      ).rejects.toThrow(/E_AI_PLAN_VALIDATION_FAILED|rejected|twice/i);
    } finally {
      await sqlitePlugin.disconnect(src.handle as never);
    }
  });

  it("rejects a plan that tries read_json_auto", async () => {
    const src = await seedSource(
      "app.db",
      `CREATE TABLE users (id INTEGER); INSERT INTO users VALUES (1);`,
      "app"
    );
    try {
      const fileReadPlan = {
        plan_english: "Steal /etc/passwd.",
        sources: [{ connection: "app", table: "users" }],
        sql: "SELECT * FROM read_json_auto('/etc/passwd')",
      };
      await expect(
        runQuery({
          nl: "doesn't matter",
          sources: [src],
          generator: fixedGen(fileReadPlan),
        })
      ).rejects.toThrow(/E_AI_PLAN_VALIDATION_FAILED|rejected/i);
    } finally {
      await sqlitePlugin.disconnect(src.handle as never);
    }
  });
});

describe("pipeline.runQuery — truncation", () => {
  it("flags truncations[] when a source hits the per-source limit", async () => {
    const src = await seedSource(
      "app.db",
      `CREATE TABLE users (id INTEGER, email TEXT);
       INSERT INTO users VALUES (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e');`,
      "app"
    );
    try {
      const plan = {
        plan_english: "All users.",
        sources: [{ connection: "app", table: "users" }],
        sql: "SELECT id FROM app__users",
      };
      const result = await runQuery({
        nl: "all users",
        sources: [src],
        generator: fixedGen(plan),
        perSourceLimit: 2,
      });
      expect(result.truncations).toEqual([
        { connection: "app", table: "users", appliedLimit: 2 },
      ]);
      expect(result.rows).toHaveLength(2);
    } finally {
      await sqlitePlugin.disconnect(src.handle as never);
    }
  });
});
