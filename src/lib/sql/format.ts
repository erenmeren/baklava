import { format } from "sql-formatter";

export type SqlDialect = "postgresql" | "tsql";

/**
 * Pretty-print SQL for the editor's "Format" action. Throws on unparseable
 * input (caller surfaces a toast). Keyword-uppercasing matches how the
 * editors already syntax-highlight.
 */
export function formatSql(sql: string, dialect: SqlDialect): string {
  return format(sql, {
    language: dialect,
    keywordCase: "upper",
    tabWidth: 2,
    expressionWidth: 80,
  });
}
