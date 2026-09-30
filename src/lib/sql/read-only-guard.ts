/**
 * Static screen for the AI's "read-only" SQL tools (`pg_run_sql`,
 * `mysql_run_sql`, `mssql_run_sql`). Those tools are category `read`, so they
 * run without approval and are open to `read`-grant members — which means the
 * statement they run must not be able to change anything, for any author,
 * including a model steered by prompt injection.
 *
 * The drivers also wrap the statement in a read-only transaction / rollback;
 * that is the backstop, not the guard, because each engine has ways out of it:
 * Postgres runs `COPY … TO PROGRAM`, `dblink_exec` and `pg_terminate_backend`
 * inside READ ONLY; MySQL's `INTO OUTFILE` writes a server file; T-SQL needs no
 * `;` between statements, so `SELECT 1 COMMIT KILL 57` is three statements.
 *
 * So the screen is an allowlist on the *shape* (one statement that starts with
 * a read keyword) plus a denylist of words that act, checked over the code with
 * string literals blanked and comments removed. Where the tokenizer and the
 * server could disagree about where a literal ends (backslash escapes, dollar
 * quotes, U& escapes, MySQL executable comments) the query is rejected instead
 * of guessed at. It is still a screen: the connection's DB role is the real
 * boundary, and a least-privilege read-only role is the recommended setup.
 */

export type ReadOnlyDialect = "postgres" | "mysql" | "sqlserver";

const FIRST_KEYWORDS: Record<ReadOnlyDialect, readonly string[]> = {
  postgres: ["select", "with", "values", "table", "show", "explain"],
  mysql: ["select", "with", "values", "table", "show", "explain", "describe", "desc"],
  sqlserver: ["select", "with"],
};

// Postgres and MySQL run exactly one statement here and it starts with a read
// keyword, so a write can only hide in a subquery or CTE (Postgres allows
// data-modifying CTEs) or behind a function. T-SQL is different: any statement
// keyword can start a *new* statement mid-batch without a `;`, so its list also
// carries the statement verbs that act.
const COMMON_DENY = [
  "insert", "update", "delete", "merge", "drop", "create", "alter", "truncate", "grant",
  "revoke", "commit", "rollback", "savepoint", "begin", "exec", "execute", "into",
];

const DIALECT_DENY: Record<ReadOnlyDialect, readonly string[]> = {
  postgres: [
    "copy", "set_config", "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
    "pg_rotate_logfile", "pg_promote", "pg_switch_wal", "pg_create_restore_point",
    "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "pg_file_write",
    "pg_notify", "pg_sleep", "pg_sleep_for", "pg_sleep_until", "pg_logical_emit_message",
    // These run a query passed as a *string*, which the screen can't see into.
    "query_to_xml", "query_to_xml_and_xmlschema", "query_to_xmlschema", "cursor_to_xml",
    "cursor_to_xmlschema",
  ],
  mysql: [
    "outfile", "dumpfile", "load_file", "sleep", "benchmark", "get_lock", "release_lock",
    "release_all_locks",
  ],
  sqlserver: [
    "kill", "backup", "restore", "shutdown", "dbcc", "reconfigure", "checkpoint", "waitfor",
    "openrowset", "opendatasource", "openquery", "bulk", "use", "deny", "enable", "disable",
    "setuser", "revert", "readtext", "writetext", "updatetext", "dump", "load", "save",
    // Service Broker: SEND / RECEIVE / END|MOVE CONVERSATION change queues.
    "send", "receive", "conversation",
  ],
};

/** Name prefixes that act: dblink_*, lo_* (large objects), advisory locks, SQL
 *  Server's system / extended procedures. */
const DENY_PREFIXES: Record<ReadOnlyDialect, readonly string[]> = {
  postgres: ["dblink", "lo_", "pg_advisory", "pg_try_advisory"],
  mysql: [],
  sqlserver: ["sp_", "xp_"],
};

function reject(reason: string): never {
  throw new Error(`Read-only query rejected: ${reason}.`);
}

/**
 * Blank string literals, drop comments, and expose the text of quoted
 * identifiers (so `"pg_terminate_backend"(1)` is still seen). Rejects the
 * constructs whose extent the server could read differently than we do.
 */
function codeOnly(sql: string, dialect: ReadOnlyDialect): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  const until = (close: string, kind: "string" | "ident"): string => {
    let j = i + 1;
    let body = "";
    for (;;) {
      if (j >= n) reject(`unterminated ${kind === "string" ? "string literal" : "quoted identifier"}`);
      const c = sql[j];
      if (c === "\\") reject("backslashes inside quotes are not supported");
      if (c === close) {
        if (sql[j + 1] === close) {
          body += c;
          j += 2;
          continue;
        }
        break;
      }
      body += c;
      j++;
    }
    i = j + 1;
    return body;
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'") {
      until("'", "string");
      out += " '' ";
      continue;
    }
    if (ch === '"' || (ch === "`" && dialect === "mysql") || (ch === "[" && dialect === "sqlserver")) {
      // Keep the text of quoted identifiers so `"pg_terminate_backend"(1)` is
      // still screened. MySQL reads "…" as a string or (ANSI_QUOTES) an
      // identifier depending on sql_mode, so it gets the identifier treatment.
      const body = until(ch === "[" ? "]" : ch, "ident");
      out += ` ${body} `;
      continue;
    }
    if (ch === "-" && next === "-") {
      // MySQL only treats `-- ` (dash dash whitespace) as a comment; `--1` is
      // arithmetic there. Treating it as code is the conservative reading.
      if (dialect === "mysql" && !/\s/.test(sql[i + 2] ?? " ")) {
        out += ch;
        i++;
        continue;
      }
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (ch === "#" && dialect === "mysql") {
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      if (dialect === "mysql" && (sql[i + 2] === "!" || sql[i + 2] === "+")) {
        reject("MySQL executable comments are not supported");
      }
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) reject("unterminated comment");
      // Postgres and T-SQL nest block comments; ending at the first `*/`
      // only ever exposes *more* text to the denylist, never less.
      i = end + 2;
      out += " ";
      continue;
    }
    if (dialect === "postgres") {
      if (ch === "$" && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
        reject("dollar-quoted strings are not supported");
      }
      if ((ch === "u" || ch === "U") && next === "&" && /['"]/.test(sql[i + 2] ?? "")) {
        reject("U& escaped literals are not supported");
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function wordsOf(code: string): string[] {
  return (code.toLowerCase().match(/[a-z0-9_$@#]+/g) ?? []).filter((t) => /[a-z]/.test(t));
}

// A numeric literal can end right where a keyword starts: T-SQL reads
// `0xKILL` as the empty binary `0x` followed by KILL, and `1e0kill` as a float
// then KILL. So besides the token itself, check what follows any numeric,
// hex or money prefix.
const NUMERIC_PREFIX = /^(?:0x[0-9a-f]*|\$?[0-9][0-9.]*(?:e[+-]?[0-9]*)?|\$)$/;

function candidates(token: string): string[] {
  const out = [token];
  for (let k = 1; k < token.length; k++) {
    if (NUMERIC_PREFIX.test(token.slice(0, k))) out.push(token.slice(k));
  }
  return out;
}

/**
 * Throws unless `sql` is a single statement that only reads. Returns the
 * statement with any trailing `;` removed.
 */
export function assertReadOnlySql(sql: string, dialect: ReadOnlyDialect): string {
  const stmt = sql.replace(/[;\s]+$/, "").trim();
  if (!stmt) reject("empty query");
  const code = codeOnly(stmt, dialect);
  if (code.includes(";")) reject("only a single statement is allowed");

  const words = wordsOf(code);
  const first = words[0];
  if (!first || !FIRST_KEYWORDS[dialect].includes(first)) {
    reject(`it must start with ${FIRST_KEYWORDS[dialect].map((k) => k.toUpperCase()).join(" / ")}`);
  }
  if (first === "explain" && (words[1] === "analyze" || words[1] === "analyse")) {
    reject("EXPLAIN ANALYZE executes the statement");
  }

  const deny = new Set([...COMMON_DENY, ...DIALECT_DENY[dialect]]);
  for (const token of words) {
    for (const w of candidates(token)) {
      if (deny.has(w)) reject(`contains "${w.toUpperCase()}"`);
      if (DENY_PREFIXES[dialect].some((p) => w.startsWith(p))) reject(`calls "${w}"`);
    }
  }
  return stmt;
}
