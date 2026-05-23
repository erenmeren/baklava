// Curated keyword + type lists used by the SQL editors' autocomplete.
//
// `@codemirror/lang-sql`'s PostgreSQL and MSSQL dialects ship the SQL standard
// keyword union (SQL92/2008/2016 + extensions), which leaks rarely-used or
// non-applicable terms (e.g. `use_variable`, `message_length`). These lists
// are sourced from each dialect's official keyword reference:
//
//   PostgreSQL: https://www.postgresql.org/docs/current/sql-keywords-appendix.html
//   T-SQL    : https://learn.microsoft.com/sql/t-sql/language-elements/reserved-keywords-transact-sql
//
// Words are lowercase here; the keyword source uppercases them when the editor
// asks for upper-case keywords.

// ─── PostgreSQL ─────────────────────────────────────────────────────────────

export const POSTGRES_KEYWORDS: string[] = [
  // Query / DML
  "select", "from", "where", "group", "by", "having", "order", "limit",
  "offset", "fetch", "first", "next", "row", "rows", "only", "distinct",
  "all", "as", "with", "recursive", "returning",
  "insert", "into", "values", "update", "set", "delete",
  "union", "intersect", "except",
  // Joins
  "join", "inner", "outer", "left", "right", "full", "cross", "natural",
  "using", "on", "lateral",
  // Predicates / boolean
  "and", "or", "not", "in", "exists", "any", "some", "between",
  "like", "ilike", "similar", "to", "is", "isnull", "notnull",
  "null", "true", "false", "unknown", "escape",
  "case", "when", "then", "else", "end",
  // Lock clauses
  "for", "update", "share", "key", "no", "nowait", "skip", "locked", "of",
  // Window / set-returning
  "over", "partition", "window", "range", "groups", "rows",
  "following", "preceding", "current", "unbounded", "exclude", "ties", "others",
  "filter",
  // DDL
  "create", "alter", "drop", "table", "view", "materialized", "index",
  "sequence", "function", "procedure", "trigger", "type", "domain",
  "schema", "database", "tablespace", "extension", "role", "user", "group",
  "if", "exists", "rename", "add", "column", "constraint",
  "primary", "foreign", "references", "check", "default", "unique",
  "generated", "always", "identity", "enum",
  "restrict", "cascade", "deferrable", "initially", "deferred", "immediate",
  "temporary", "temp", "unlogged", "inherits", "include", "including",
  "excluding", "comments", "defaults", "storage", "statistics",
  // Partitioning
  "partition", "of", "values", "list", "hash",
  // Maintenance / utilities
  "truncate", "copy", "explain", "analyze", "vacuum", "verbose", "reindex",
  "cluster", "refresh", "concurrently",
  "import", "server", "mapping", "wrapper", "options",
  // Transactions
  "begin", "commit", "rollback", "savepoint", "release",
  "start", "transaction", "isolation", "level",
  "serializable", "repeatable", "read", "committed", "uncommitted",
  "write", "abort", "work",
  // Functions / operators
  "cast", "convert", "extract", "overlay", "position", "substring",
  "trim", "collate", "timezone", "coalesce", "nullif", "greatest", "least",
  "count", "sum", "avg", "min", "max",
  "row_number", "rank", "dense_rank", "lag", "lead",
  "first_value", "last_value", "nth_value", "ntile",
  "percent_rank", "cume_dist", "array", "row",
  // Roles / security
  "grant", "revoke", "owner", "owned", "public", "privileges",
  "usage", "execute", "connect", "authorization", "policy", "enable", "disable",
  // System / session
  "show", "reset", "session", "local", "names", "search_path",
  "notify", "listen", "unlisten", "load", "comment", "do",
];

export const POSTGRES_TYPES: string[] = [
  // Numeric
  "smallint", "integer", "int", "int2", "int4", "int8",
  "bigint", "decimal", "numeric", "real", "double", "precision",
  "float4", "float8", "serial", "bigserial", "smallserial", "money",
  // Character / binary
  "character", "varying", "varchar", "char", "text", "bytea",
  // Boolean / date / time
  "boolean", "bool", "date", "time", "timestamp", "timestamptz",
  "timetz", "interval",
  // Identifier / network / geometric
  "uuid", "inet", "cidr", "macaddr", "macaddr8",
  "point", "line", "lseg", "box", "path", "polygon", "circle",
  // JSON / XML / text search
  "json", "jsonb", "xml", "tsvector", "tsquery",
  // Object identifier types
  "oid", "regclass", "regconfig", "regdictionary", "regnamespace",
  "regoper", "regoperator", "regproc", "regprocedure", "regrole", "regtype",
];

// ─── SQL Server (T-SQL) ─────────────────────────────────────────────────────

export const SQLSERVER_KEYWORDS: string[] = [
  // Query / DML
  "select", "from", "where", "group", "by", "having", "order", "asc", "desc",
  "top", "percent", "with", "ties", "distinct", "all", "as",
  "insert", "into", "values", "update", "set", "delete",
  "output", "returns", "return",
  "union", "intersect", "except",
  // Joins
  "join", "inner", "outer", "left", "right", "full", "cross", "apply",
  "using", "on",
  // CTE / windowing
  "over", "partition", "by", "rows", "range", "between",
  "preceding", "following", "current", "unbounded", "row",
  // Predicates
  "and", "or", "not", "in", "exists", "any", "some", "between",
  "like", "is", "null", "true", "false",
  "case", "when", "then", "else", "end", "iif",
  // MERGE
  "merge", "using", "matched", "target", "source",
  // FOR XML / JSON
  "for", "xml", "json", "path", "auto", "raw", "explicit",
  "elements", "root", "namespaces", "openjson", "openxml", "openrowset",
  // DDL
  "create", "alter", "drop", "table", "view", "index", "sequence",
  "function", "procedure", "proc", "trigger", "synonym", "type",
  "schema", "database", "login", "user", "role", "server",
  "if", "exists", "rename", "add", "column", "constraint",
  "primary", "foreign", "references", "check", "default", "unique",
  "clustered", "nonclustered", "include",
  "identity", "rowguidcol", "filestream", "sparse",
  "restrict", "cascade", "no", "action",
  "temporary", "temp",
  // Programming
  "declare", "set", "exec", "execute", "print", "raiserror", "throw",
  "begin", "end", "try", "catch", "if", "else", "while", "break", "continue",
  "return", "goto", "waitfor", "delay", "time",
  "cursor", "open", "close", "deallocate", "fetch", "next", "prior",
  "absolute", "relative",
  // Transactions
  "transaction", "tran", "commit", "rollback", "save", "savepoint",
  "isolation", "level", "serializable", "repeatable", "read",
  "committed", "uncommitted", "snapshot",
  // Maintenance
  "truncate", "use", "go", "checkpoint", "dbcc", "kill",
  "backup", "restore", "log", "shrinkdatabase", "shrinkfile",
  // Functions
  "cast", "convert", "try_cast", "try_convert", "parse", "try_parse",
  "isnull", "coalesce", "nullif",
  "count", "sum", "avg", "min", "max",
  "row_number", "rank", "dense_rank", "ntile",
  "lag", "lead", "first_value", "last_value",
  "getdate", "getutcdate", "sysdatetime", "newid", "newsequentialid",
  "object_id", "object_name", "schema_name", "db_name",
  // Hints / locking
  "nolock", "readpast", "rowlock", "tablock", "tablockx", "updlock", "xlock",
  "noexpand", "holdlock", "readcommitted", "readuncommitted",
  // Security
  "grant", "revoke", "deny", "owner", "authorization",
];

export const SQLSERVER_TYPES: string[] = [
  // Numeric
  "tinyint", "smallint", "int", "bigint", "bit",
  "decimal", "numeric", "money", "smallmoney", "float", "real",
  // Date / time
  "date", "datetime", "datetime2", "datetimeoffset", "smalldatetime", "time",
  // Character
  "char", "varchar", "text", "nchar", "nvarchar", "ntext",
  // Binary
  "binary", "varbinary", "image",
  // Other
  "uniqueidentifier", "rowversion", "timestamp", "sql_variant",
  "xml", "hierarchyid", "geography", "geometry", "table", "cursor",
];
