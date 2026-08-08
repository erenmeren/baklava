import { describe, it, expect } from "vitest";
import * as mssql from "./sqlserver";

/**
 * The public *function* surface of the sqlserver driver, captured before the
 * module split. Every name here must remain importable from
 * "@/lib/connections/sqlserver" — 35 call sites depend on it.
 *
 * To regenerate after a deliberate API change:
 *   grep -o '^export \(async \)\?function [a-zA-Z_]*' src/lib/connections/sqlserver.ts \
 *     | awk '{print $NF}' | sort
 */
const EXPECTED_FUNCTIONS = [
  "alterSqlServerTable",
  "backupSqlServerDatabase",
  "buildSqlServerTableDDL",
  "classifyWait",
  "createSqlServerDatabase",
  "createSqlServerSchema",
  "createSqlServerSequence",
  "createSqlServerSynonym",
  "createSqlServerTable",
  "createSqlServerTableType",
  "createSqlServerType",
  "deleteSqlServerRow",
  "dropSqlServerDatabase",
  "dropSqlServerObject",
  "dropSqlServerSchema",
  "executeSqlServerDdl",
  "getQueryStore",
  "getSqlServerBackupHistory",
  "getSqlServerDependencies",
  "getSqlServerEstimatedPlan",
  "getSqlServerExpensiveQueries",
  "getSqlServerIndexFragmentation",
  "getSqlServerMissingIndexes",
  "getSqlServerModule",
  "getSqlServerOverview",
  "getSqlServerOverviewExtras",
  "getSqlServerSecurity",
  "getSqlServerTableData",
  "getSqlServerTableDetail",
  "insertSqlServerRow",
  "killSqlServerSession",
  "listSqlServerActivity",
  "listSqlServerBlocking",
  "listSqlServerDatabases",
  "listSqlServerObjects",
  "listSqlServerSchemaColumns",
  "listSqlServerSchemas",
  "listSqlServerTables",
  "maintainSqlServerIndex",
  "probeSqlServer",
  "requireNoStatementTerminator",
  "runReadOnlyQuery",
  "runSqlServerScript",
  "setQueryStorePlanForced",
  "splitGoBatches",
  "updateSqlServerRow",
  "validateSqlServerDatabaseName",
  "validateSqlServerIdentifier",
] as const;

/**
 * The public *non-function value* surface (consts, enums-as-objects, etc.).
 * Verified by inspection, not assumed:
 *   grep -rn '^export const' src/lib/connections/sqlserver/*.ts
 * finds exactly one — SQLSERVER_DB_NAME_RE, a regex, in sql.ts.
 */
const EXPECTED_VALUES = ["SQLSERVER_DB_NAME_RE"] as const;

describe("sqlserver driver barrel", () => {
  it("re-exports every public function", () => {
    const missing = EXPECTED_FUNCTIONS.filter(
      (name) => typeof (mssql as unknown as Record<string, unknown>)[name] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("re-exports every public non-function value", () => {
    const missing = EXPECTED_VALUES.filter(
      (name) => !(name in (mssql as unknown as Record<string, unknown>)),
    );
    expect(missing).toEqual([]);
  });

  it("exports exactly the documented surface — no accidental additions", () => {
    const actualFunctions = Object.keys(mssql)
      .filter((k) => typeof (mssql as unknown as Record<string, unknown>)[k] === "function")
      .sort();
    expect(actualFunctions).toEqual([...EXPECTED_FUNCTIONS].sort());

    const actualValues = Object.keys(mssql)
      .filter((k) => typeof (mssql as unknown as Record<string, unknown>)[k] !== "function")
      .sort();
    expect(actualValues).toEqual([...EXPECTED_VALUES].sort());
  });
});
