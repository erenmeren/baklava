import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sqlitePlugin, type SqliteHandle } from "../../lib/sources/sqlite";
import type { ConnectionConfig } from "../../lib/sources/types";

let tmpDir = "";
let dbPath = "";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "baklava-sqlite-"));
  dbPath = join(tmpDir, "test.sqlite");
  // Seed the SQLite file with a small fixture.
  const seed = new Database(dbPath);
  // NOT NULL is spelled out so PRAGMA table_info reports notnull=1 on the PK
  // (SQLite's INTEGER PRIMARY KEY is the rowid alias, which is nullable per
  // PRAGMA even though it's auto-filled). Real production schemas spell it out.
  seed.exec(`
    CREATE TABLE users (
      id INTEGER NOT NULL PRIMARY KEY,
      email TEXT NOT NULL,
      plan_tier TEXT
    );
    CREATE TABLE orders (
      id INTEGER NOT NULL PRIMARY KEY,
      user_id INTEGER,
      status TEXT
    );
    INSERT INTO users (id, email, plan_tier) VALUES
      (1, 'a@example.com', 'pro'),
      (2, 'b@example.com', 'free'),
      (3, 'c@example.com', 'pro');
    INSERT INTO orders (id, user_id, status) VALUES
      (101, 1, 'paid'),
      (102, 2, 'abandoned'),
      (103, 1, 'paid');
  `);
  seed.close();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function configFor(path: string): ConnectionConfig {
  return { name: "test-sqlite", plugin: "sqlite", config: { path } };
}

describe("sqlitePlugin.validateConfig", () => {
  it("accepts a string path", () => {
    expect(() => sqlitePlugin.validateConfig(configFor(dbPath))).not.toThrow();
  });

  it("rejects a config without path", () => {
    expect(() =>
      sqlitePlugin.validateConfig({ name: "x", plugin: "sqlite", config: {} })
    ).toThrow(/path/i);
  });

  it("rejects a non-string path", () => {
    expect(() =>
      sqlitePlugin.validateConfig({
        name: "x",
        plugin: "sqlite",
        config: { path: 42 },
      })
    ).toThrow(/path/i);
  });
});

describe("sqlitePlugin lifecycle + queries", () => {
  let handle: SqliteHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await sqlitePlugin.disconnect(handle);
      handle = null;
    }
  });

  it("connects, health-checks green, and lists tables with mapped DuckDB types", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    const health = await sqlitePlugin.health(handle);
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);

    const tables = await sqlitePlugin.listTables(handle);
    const byName = Object.fromEntries(tables.map((t) => [t.table, t]));

    expect(byName.users).toBeDefined();
    expect(byName.orders).toBeDefined();

    const idCol = byName.users!.columns.find((c) => c.name === "id");
    expect(idCol?.duckdbType).toBe("BIGINT");
    expect(idCol?.nullable).toBe(false);

    const planTier = byName.users!.columns.find((c) => c.name === "plan_tier");
    expect(planTier?.duckdbType).toBe("VARCHAR");
    expect(planTier?.nullable).toBe(true);
  });

  it("fetches all rows when no filter is applied", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    const rows: Record<string, unknown>[] = [];
    for await (const r of sqlitePlugin.fetchRows(handle, { table: "users" })) {
      rows.push(r);
    }
    expect(rows).toHaveLength(3);
    expect(rows[0]!.email).toBeTypeOf("string");
  });

  it("applies a column allowlist", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    const rows: Record<string, unknown>[] = [];
    for await (const r of sqlitePlugin.fetchRows(handle, {
      table: "users",
      columns: ["email"],
    })) {
      rows.push(r);
    }
    expect(rows[0]).toEqual({ email: "a@example.com" });
    expect(rows[0]).not.toHaveProperty("plan_tier");
  });

  it("compiles eq/neq/in/range filters with parameter binding", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    const rows: Record<string, unknown>[] = [];
    for await (const r of sqlitePlugin.fetchRows(handle, {
      table: "users",
      columns: ["id", "plan_tier"],
      where: {
        op: "and",
        clauses: [
          { op: "eq", column: "plan_tier", value: "pro" },
          { op: "in", column: "id", values: [1, 3] },
        ],
      },
    })) {
      rows.push(r);
    }
    expect(rows.map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it("rejects a fetch against a non-existent table", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    await expect(
      (async () => {
        for await (const _r of sqlitePlugin.fetchRows(handle!, { table: "ghost" })) {
          // unreachable
        }
      })()
    ).rejects.toThrow(/E_SOURCE_FETCH_FAILED|does not exist/);
  });

  it("rejects a fetch with an undeclared column", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    await expect(
      (async () => {
        for await (const _r of sqlitePlugin.fetchRows(handle!, {
          table: "users",
          columns: ["password_hash"],
        })) {
          // unreachable
        }
      })()
    ).rejects.toThrow(/E_AI_PLAN_VALIDATION_FAILED|does not exist|hallucinated/);
  });

  it("rejects a filter against an undeclared column", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    await expect(
      (async () => {
        for await (const _r of sqlitePlugin.fetchRows(handle!, {
          table: "users",
          where: { op: "eq", column: "secret", value: "x" },
        })) {
          // unreachable
        }
      })()
    ).rejects.toThrow(/E_AI_PLAN_VALIDATION_FAILED|undeclared/);
  });

  it("clamps limit and stops streaming at the cap", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    const rows: Record<string, unknown>[] = [];
    for await (const r of sqlitePlugin.fetchRows(handle, {
      table: "users",
      limit: 2,
    })) {
      rows.push(r);
    }
    expect(rows).toHaveLength(2);
  });

  it("returns an unhealthy status for a closed handle", async () => {
    handle = await sqlitePlugin.connect(configFor(dbPath));
    await sqlitePlugin.disconnect(handle);
    const health = await sqlitePlugin.health(handle);
    handle = null; // already closed
    expect(health.ok).toBe(false);
  });
});
