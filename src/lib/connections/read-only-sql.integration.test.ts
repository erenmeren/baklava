/**
 * Integration test: the AI read-only SQL path (`runReadOnlyQuery`) against real
 * servers — ordinary reads still run, the escapes the READ ONLY transaction
 * doesn't stop are refused, and Postgres reads carry a statement timeout.
 * Gated by BAKLAVA_INTEGRATION=1; `docker compose up -d postgres mysql`.
 */
import { describe, it, expect } from "vitest";
import { reachable } from "@/test/integration-helpers";
import { runReadOnlyQuery as pgRead } from "./postgres/query";
import { runReadOnlyQuery as myRead } from "./mysql";

const pg = {
  host: "localhost",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: "Baklava123!",
  ssl: false,
};
const my = { host: "localhost", port: 3306, user: "root", password: "Baklava123!", ssl: false };

describe("postgres runReadOnlyQuery against a real server", async () => {
  const up = await reachable("localhost", 5432);

  it.skipIf(!up)("runs an ordinary read (CTE, CASE … END, replace())", async () => {
    const res = await pgRead(
      pg as never,
      "postgres",
      "WITH t AS (SELECT 'a-b' AS s) SELECT CASE WHEN s <> '' THEN replace(s, '-', '_') END FROM t",
    );
    expect(res.rows).toEqual([["a_b"]]);
  });

  it.skipIf(!up)("caps a read with a 30s statement_timeout", async () => {
    const res = await pgRead(pg as never, "postgres", "SELECT current_setting('statement_timeout')");
    expect(res.rows).toEqual([["30s"]]);
  });

  it.skipIf(!up)("refuses pg_terminate_backend, which READ ONLY would let through", async () => {
    await expect(
      pgRead(pg as never, "postgres", "SELECT pg_terminate_backend(pg_backend_pid())"),
    ).rejects.toThrow(/Read-only query rejected/);
  });
});

describe("mysql runReadOnlyQuery against a real server", async () => {
  const up = await reachable("localhost", 3306);

  it.skipIf(!up)("runs an ordinary read", async () => {
    const res = await myRead(my as never, "mysql", "SELECT REPLACE('a-b', '-', '_') AS s");
    expect(res.rows).toEqual([["a_b"]]);
  });

  it.skipIf(!up)("refuses INTO OUTFILE, which READ ONLY would let through", async () => {
    await expect(
      myRead(my as never, "mysql", "SELECT 1 INTO OUTFILE '/tmp/baklava-x'"),
    ).rejects.toThrow(/Read-only query rejected/);
  });
});
