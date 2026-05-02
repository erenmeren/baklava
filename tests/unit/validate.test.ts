import { describe, it, expect } from "vitest";
import { validatePlan, type DeclaredSource } from "../../lib/ai/validate.js";

const usersSource: DeclaredSource = {
  table: "pg_users",
  columns: [
    { name: "id", duckdbType: "INTEGER" },
    { name: "email", duckdbType: "VARCHAR" },
    { name: "plan_tier", duckdbType: "VARCHAR" },
  ],
};

const ordersSource: DeclaredSource = {
  table: "pg_orders",
  columns: [
    { name: "id", duckdbType: "INTEGER" },
    { name: "user_id", duckdbType: "INTEGER" },
    { name: "status", duckdbType: "VARCHAR" },
    { name: "created_at", duckdbType: "TIMESTAMP" },
  ],
};

describe("validatePlan — happy paths", () => {
  it("accepts a simple SELECT against one declared source", async () => {
    const r = await validatePlan({
      sql: `SELECT id, email FROM pg_users WHERE plan_tier = 'pro'`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a JOIN across two declared sources", async () => {
    const r = await validatePlan({
      sql: `SELECT u.email, o.status FROM pg_users u JOIN pg_orders o ON u.id = o.user_id WHERE o.status = 'abandoned'`,
      sources: [usersSource, ordersSource],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts SELECT * across declared sources", async () => {
    const r = await validatePlan({
      sql: `SELECT * FROM pg_users`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts ORDER BY + LIMIT + GROUP BY", async () => {
    const r = await validatePlan({
      sql: `SELECT plan_tier, COUNT(*) AS n FROM pg_users GROUP BY plan_tier ORDER BY n DESC LIMIT 10`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a subquery in WHERE", async () => {
    const r = await validatePlan({
      sql: `SELECT email FROM pg_users WHERE id IN (SELECT user_id FROM pg_orders WHERE status = 'paid')`,
      sources: [usersSource, ordersSource],
    });
    expect(r.ok).toBe(true);
  });
});

describe("validatePlan — phantom-table protection", () => {
  it("rejects SQL referencing a table not in declared sources", async () => {
    const r = await validatePlan({
      sql: `SELECT * FROM secret_table`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/duckdb|secret_table|catalog|reference/i);
  });

  it("rejects JOIN to an undeclared table even when one side is declared", async () => {
    const r = await validatePlan({
      sql: `SELECT u.email FROM pg_users u JOIN admin_audit a ON u.id = a.user_id`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects reference to an undeclared column on a declared table", async () => {
    const r = await validatePlan({
      sql: `SELECT password_hash FROM pg_users`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validatePlan — DML / DDL rejection", () => {
  it("rejects INSERT", async () => {
    const r = await validatePlan({
      sql: `INSERT INTO pg_users (id, email) VALUES (1, 'evil@example.com')`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects UPDATE", async () => {
    const r = await validatePlan({
      sql: `UPDATE pg_users SET plan_tier = 'free'`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects DELETE", async () => {
    const r = await validatePlan({
      sql: `DELETE FROM pg_users`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects DROP TABLE", async () => {
    const r = await validatePlan({
      sql: `DROP TABLE pg_users`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects multi-statement SQL", async () => {
    const r = await validatePlan({
      sql: `SELECT * FROM pg_users; DELETE FROM pg_users;`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validatePlan — DuckDB-specific attack surface", () => {
  it("rejects read_json_auto file-read primitive", async () => {
    const r = await validatePlan({
      sql: `SELECT * FROM read_json_auto('/etc/passwd')`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects read_csv against an arbitrary path", async () => {
    const r = await validatePlan({
      sql: `SELECT * FROM read_csv('/etc/passwd')`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects read_parquet against a remote URL", async () => {
    const r = await validatePlan({
      sql: `SELECT * FROM read_parquet('s3://attacker/secrets.parquet')`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects ATTACH database", async () => {
    const r = await validatePlan({
      sql: `ATTACH 'attacker.db' AS evil`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects PRAGMA", async () => {
    const r = await validatePlan({
      sql: `PRAGMA show_tables`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects INSTALL extension", async () => {
    const r = await validatePlan({
      sql: `INSTALL httpfs`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects LOAD extension", async () => {
    const r = await validatePlan({
      sql: `LOAD httpfs`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects COPY (export to file)", async () => {
    const r = await validatePlan({
      sql: `COPY pg_users TO '/tmp/exfil.csv'`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validatePlan — edge cases", () => {
  it("rejects empty SQL", async () => {
    const r = await validatePlan({ sql: "", sources: [usersSource] });
    expect(r.ok).toBe(false);
  });

  it("rejects whitespace-only SQL", async () => {
    const r = await validatePlan({ sql: "   \n  ", sources: [usersSource] });
    expect(r.ok).toBe(false);
  });

  it("rejects unparseable SQL", async () => {
    const r = await validatePlan({
      sql: `this is not sql at all`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects SQL that mixes a SELECT with an injected DELETE", async () => {
    const r = await validatePlan({
      sql: `SELECT * FROM pg_users WHERE id = 1; DELETE FROM pg_users`,
      sources: [usersSource],
    });
    expect(r.ok).toBe(false);
  });
});
