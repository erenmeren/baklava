import { describe, it, expect } from "vitest";
import {
  requireSqlServerDataType,
  requireSqlServerDefaultExpression,
  requireSqlServerObjectName,
} from "./sql";

// T-SQL runs `int) DROP TABLE x --` as a second statement with no `;`, so these
// fragments are validated by shape, not by screening for `;`.

describe("requireSqlServerDataType", () => {
  it.each([
    "int", "nvarchar(max)", "NVARCHAR(50)", "decimal(18, 2)", "datetime2(7)", "dbo.MyType",
    "[my type]", "double precision", "varbinary( max )",
  ])("accepts %s", (t) => expect(requireSqlServerDataType(t, "Column type")).toBe(t.trim()));

  it.each([
    "int) DROP TABLE dbo.orders --",
    "int DROP TABLE x",
    "int NULL; DROP TABLE x",
    "nvarchar(50) COLLATE x",
    "[a]] DROP TABLE x --]",
    "int /* */",
    "",
  ])("rejects %s", (t) => expect(() => requireSqlServerDataType(t, "Column type")).toThrow());
});

describe("requireSqlServerDefaultExpression", () => {
  it.each([
    "0", "'n/a'", "getdate()", "(1)", "N'it''s'", "newid()", "CONVERT(int, '5')", "'a)b'",
  ])("accepts %s", (e) => expect(requireSqlServerDefaultExpression(e, "Default")).toBe(e));

  it.each([
    "0) DROP TABLE dbo.users --",
    "0)) EXEC xp_cmdshell 'whoami' ((",
    "1 -- )",
    "1 /* ) */",
    "'unterminated",
    "(1",
    "1; DROP TABLE x",
  ])("rejects %s", (e) => expect(() => requireSqlServerDefaultExpression(e, "Default")).toThrow());
});

describe("requireSqlServerObjectName", () => {
  it.each(["t", "dbo.t", "db.dbo.t", "srv.db.dbo.t", "db..t", "[my db].[dbo].[t 1]"])(
    "accepts %s",
    (n) => expect(requireSqlServerObjectName(n, "Target")).toBe(n),
  );

  it.each([
    "dbo.x DROP TABLE dbo.users",
    "a.b.c.d.e",
    "[x]] DROP TABLE t --]",
    "dbo.t --",
    "",
  ])("rejects %s", (n) => expect(() => requireSqlServerObjectName(n, "Target")).toThrow());
});
