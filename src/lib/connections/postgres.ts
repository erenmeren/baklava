/**
 * Postgres driver — barrel.
 *
 * The implementation lives in ./postgres/*. This file exists so the 39
 * existing import sites keep working unchanged; prefer importing from the
 * specific module in new code.
 */
export * from "./postgres/client";
export * from "./postgres/sql";
export * from "./postgres/catalog";
export * from "./postgres/rows";
export * from "./postgres/ddl";
export * from "./postgres/query";
export * from "./postgres/ops";
export * from "./postgres/backup";
