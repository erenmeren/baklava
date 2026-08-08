/**
 * SQL Server driver — barrel.
 *
 * The implementation lives in ./sqlserver/*. This file exists so the 35
 * existing import sites keep working unchanged; prefer importing from the
 * specific module in new code.
 */
export * from "./sqlserver/client";
export * from "./sqlserver/sql";
export * from "./sqlserver/catalog";
export * from "./sqlserver/rows";
export * from "./sqlserver/ddl";
export * from "./sqlserver/query";
export * from "./sqlserver/ops";
export * from "./sqlserver/backup";
