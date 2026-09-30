import { describe, it, expect } from "vitest";
import { assertReadOnlySql, type ReadOnlyDialect } from "./read-only-guard";

const ok = (sql: string, d: ReadOnlyDialect) => expect(() => assertReadOnlySql(sql, d)).not.toThrow();
const bad = (sql: string, d: ReadOnlyDialect) =>
  expect(() => assertReadOnlySql(sql, d)).toThrow(/Read-only query rejected/);

describe("assertReadOnlySql — ordinary reads pass", () => {
  it.each<[ReadOnlyDialect, string]>([
    ["postgres", "SELECT id, updated_at, delete_flag FROM orders WHERE status = 'delete me' LIMIT 10;"],
    ["postgres", "WITH t AS (SELECT 1 AS x) SELECT CASE WHEN x > 0 THEN 'a' ELSE 'b' END FROM t"],
    ["postgres", "SELECT replace(name, 'a', 'b'), now() - interval '1 day' FROM users -- DROP TABLE x"],
    ["postgres", "EXPLAIN SELECT * FROM t"],
    ["postgres", 'SELECT "Order".id FROM "Order"'],
    ["mysql", "SELECT `id`, REPLACE(name, 'x', 'y') FROM `users` WHERE a = 1 # INSERT"],
    ["mysql", "SHOW TABLES"],
    ["mysql", "DESCRIBE users"],
    ["sqlserver", "SELECT TOP 10 [id], N'kill me' AS note FROM [dbo].[orders] ORDER BY id DESC"],
    ["sqlserver", "WITH c AS (SELECT 1 AS x) SELECT CASE WHEN x = 1 THEN 'y' END FROM c"],
    ["sqlserver", "SELECT 0x1F AS b, 1e3 AS f, $5 AS m"],
  ])("%s: %s", (d, sql) => ok(sql, d));
});

describe("assertReadOnlySql — shape", () => {
  it("must start with a read keyword", () => {
    bad("DELETE FROM t", "postgres");
    bad("COPY (SELECT 1) TO PROGRAM 'id'", "postgres");
    bad("CALL p()", "mysql");
    bad("EXEC xp_cmdshell 'whoami'", "sqlserver");
    bad("   ", "postgres");
  });

  it("only one statement", () => {
    bad("SELECT 1; DELETE FROM t", "postgres");
    bad("SELECT 1; SELECT 2", "mysql");
  });

  it("EXPLAIN ANALYZE executes, so it's out", () => {
    bad("EXPLAIN ANALYZE DELETE FROM t", "postgres");
  });
});

describe("assertReadOnlySql — Postgres escapes from READ ONLY", () => {
  it.each([
    "SELECT pg_terminate_backend(123)",
    "SELECT pg_catalog.pg_reload_conf()",
    'SELECT "pg_terminate_backend"(123)',
    "SELECT * FROM dblink('host=x', 'select 1') AS t(a int)",
    "SELECT dblink_exec('dbname=x', 'DROP TABLE t')",
    "SELECT lo_export(16384, '/tmp/x')",
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT set_config('role', 'postgres', false)",
    "SELECT query_to_xml('delete from t returning 1', true, true, '')",
    "SELECT pg_sleep(600)",
    "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
    "SELECT $$x$$",
    "SELECT $q$x$q$",
    "SELECT U&\"pg\\0074erminate_backend\"(1)",
    "SELECT E'\\x' FROM t",
    "SELECT 1 INTO newtable",
  ])("%s", (sql) => bad(sql, "postgres"));
});

describe("assertReadOnlySql — MySQL", () => {
  it.each([
    "SELECT * FROM users INTO OUTFILE '/var/www/x.php'",
    "SELECT LOAD_FILE('/etc/passwd')",
    "SELECT SLEEP(600)",
    "SELECT BENCHMARK(1e9, MD5('x'))",
    "SELECT /*!50000 SLEEP(10) */ 1",
    "SELECT GET_LOCK('x', 10)",
    'SELECT "load_file"(1)',
    "SELECT 'a\\' OR SLEEP(5) -- '",
  ])("%s", (sql) => bad(sql, "mysql"));
});

describe("assertReadOnlySql — T-SQL needs no ';' between statements", () => {
  it.each([
    "SELECT 1 COMMIT KILL 57",
    "SELECT 1\nKILL 57",
    "SELECT 1 SHUTDOWN WITH NOWAIT",
    "SELECT 1 BACKUP DATABASE x TO DISK = '\\\\evil\\share\\x.bak'",
    "SELECT 1 DBCC FREEPROCCACHE",
    "SELECT 1 EXEC sp_configure 'xp_cmdshell', 1",
    "SELECT 1 xp_cmdshell 'whoami'",
    "SELECT * FROM sys.sp_who",
    "SELECT 1 RECONFIGURE",
    "SELECT * FROM OPENROWSET(BULK 'C:\\x', SINGLE_CLOB) AS t",
    "SELECT 1 WAITFOR DELAY '01:00:00'",
    "SELECT 1 USE master",
    "SELECT * INTO dbo.copy FROM t",
    "SELECT 0xKILL 57",
    "SELECT 1e0kill 57",
    "SELECT [id] FROM t [DROP] TABLE x",
    "SELECT 1 END CONVERSATION '00000000-0000-0000-0000-000000000000'",
  ])("%s", (sql) => bad(sql, "sqlserver"));
});

it("returns the statement without its trailing ';'", () => {
  expect(assertReadOnlySql("SELECT 1 ;; ", "postgres")).toBe("SELECT 1");
});
