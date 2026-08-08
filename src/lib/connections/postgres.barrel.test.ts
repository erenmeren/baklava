import { describe, it, expect } from "vitest";
import * as pg from "./postgres";

/**
 * The public *function* surface of the postgres driver, captured before the
 * module split. Every name here must remain importable from
 * "@/lib/connections/postgres" — 39 call sites depend on it.
 *
 * To regenerate after a deliberate API change:
 *   grep -o '^export \(async \)\?function [a-zA-Z_]*' src/lib/connections/postgres.ts \
 *     | awk '{print $NF}' | sort
 */
const EXPECTED_FUNCTIONS = [
  "withClient",
  "dropPostgresPools",
  "getPoolForTests",
  "_injectPoolForTests",
  "_endAllPostgresPoolsForTests",
  "probePostgres",
  "getServerOverview",
  "getTopTables",
  "getTopTablesAllDatabases",
  "listDatabases",
  "listSchemas",
  "listSchemasWithStats",
  "listObjects",
  "listAllRelations",
  "listSchemaColumns",
  "listColumns",
  "listIndexes",
  "listConstraints",
  "listForeignKeys",
  "readTableData",
  "quoteIdent",
  "insertRow",
  "updateRow",
  "createTable",
  "deleteRow",
  "listFunctions",
  "listSequences",
  "getTableStats",
  "createSequence",
  "alterSequence",
  "dropSequence",
  "createOrReplaceFunction",
  "dropFunction",
  "getFunctionDefinition",
  "createIndex",
  "dropIndex",
  "renameIndex",
  "createOrReplaceView",
  "getViewDefinition",
  "getTableDDL",
  "validateIdentifier",
  "requireNoStatementTerminator",
  "createDatabase",
  "dropDatabase",
  "listRoles",
  "createRole",
  "alterRole",
  "dropRole",
  "createSchema",
  "dropSchema",
  "dropTable",
  "dropView",
  "alterTable",
  "explainQuery",
  "runQuery",
  "runReadOnlyQuery",
  "splitSqlStatements",
  "runQueryMulti",
  "listActivity",
  "cancelBackend",
  "terminateBackend",
  "listBlockingTree",
  "runMaintenance",
  "reindexTable",
  "getOverviewExtras",
  "getDiagnostics",
  "listExtensions",
  "createExtension",
  "dropExtension",
  "updateExtension",
  "streamDatabaseDump",
  "restoreSql",
] as const;

/**
 * The public *non-function value* surface (consts, enums-as-objects, etc.).
 * Verified empty by inspection, not assumed:
 *   grep -rn '^export const' src/lib/connections/postgres/*.ts
 * returns nothing — unlike sqlserver (SQLSERVER_DB_NAME_RE), postgres has no
 * exported const today. Kept as an explicit (empty) list, not a comment,
 * so a future exported const fails this test instead of going unnoticed.
 */
const EXPECTED_VALUES: readonly string[] = [];

describe("postgres driver barrel", () => {
  it("re-exports every public function", () => {
    const missing = EXPECTED_FUNCTIONS.filter(
      (name) => typeof (pg as unknown as Record<string, unknown>)[name] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("re-exports every public non-function value", () => {
    const missing = EXPECTED_VALUES.filter(
      (name) => !(name in (pg as unknown as Record<string, unknown>)),
    );
    expect(missing).toEqual([]);
  });

  it("exports exactly the documented surface — no accidental additions", () => {
    const actualFunctions = Object.keys(pg)
      .filter((k) => typeof (pg as unknown as Record<string, unknown>)[k] === "function")
      .sort();
    expect(actualFunctions).toEqual([...EXPECTED_FUNCTIONS].sort());

    const actualValues = Object.keys(pg)
      .filter((k) => typeof (pg as unknown as Record<string, unknown>)[k] !== "function")
      .sort();
    expect(actualValues).toEqual([...EXPECTED_VALUES].sort());
  });
});
