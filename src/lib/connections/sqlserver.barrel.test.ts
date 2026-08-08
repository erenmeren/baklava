import { describe, it, expect } from "vitest";
import * as mssql from "./sqlserver";

/**
 * The full public surface of the sqlserver driver, captured before the module
 * split. Every name here must remain importable from
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

describe("sqlserver driver barrel", () => {
  it("re-exports every public function", () => {
    const missing = EXPECTED_FUNCTIONS.filter(
      (name) => typeof (mssql as unknown as Record<string, unknown>)[name] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("exports exactly the documented surface — no accidental additions", () => {
    const actual = Object.keys(mssql)
      .filter((k) => typeof (mssql as unknown as Record<string, unknown>)[k] === "function")
      .sort();
    expect(actual).toEqual([...EXPECTED_FUNCTIONS].sort());
  });
});
