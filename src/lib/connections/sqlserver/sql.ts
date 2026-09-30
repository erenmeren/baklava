/**
 * SQL Server driver — SQL-safety helpers. The leaf module: no imports from
 * any sibling ./sqlserver/* file.
 */

// SQL Server identifier `[...]` quoting can't safely escape `]` inside the
// name in every code path, so we whitelist database names to the conservative
// SQL Server regular identifier alphabet. This is the only place we splice the
// name into SQL (for `USE [name]`); every value-only use goes through @db.
export const SQLSERVER_DB_NAME_RE = /^[A-Za-z0-9_]+$/;

/** @internal — exported for tests. */
export function validateSqlServerDatabaseName(name: string): string {
  if (!SQLSERVER_DB_NAME_RE.test(name)) {
    throw new Error(
      "Invalid database name (only letters, digits, and underscores are supported)",
    );
  }
  return name;
}

/** Conservative identifier whitelist for names spliced into SQL (USE / FROM). */
export function validateSqlServerIdentifier(name: string, kind = "identifier"): string {
  if (!SQLSERVER_DB_NAME_RE.test(name)) {
    throw new Error(`Invalid ${kind} (only letters, digits, and underscores are supported)`);
  }
  return name;
}

/**
 * Reject `;` in a free-form SQL fragment. NOT sufficient on its own for T-SQL:
 * unlike Postgres, T-SQL needs no terminator between statements
 * (`int) DROP TABLE x --` is two statements), so fragments spliced into DDL go
 * through the structural validators below instead.
 */
export function requireNoStatementTerminator(value: string, fieldName: string): string {
  if (value.includes(";")) {
    throw new Error(`${fieldName} cannot contain ';'`);
  }
  return value;
}

/**
 * Split a T-SQL script into batches on `GO` (the SSMS/sqlcmd batch
 * separator), which the TDS protocol never sees — `mssql` will throw if you
 * send it. A line of just `GO` (optionally `GO <count>` to repeat) ends a
 * batch. `;` does NOT split batches. Respects single-quoted strings, bracket
 * identifiers, and `--` / block comments so a `GO` inside those is ignored.
 */
export function splitGoBatches(script: string): Array<{ sql: string; count: number }> {
  const lines = script.split(/\r?\n/);
  const out: Array<{ sql: string; count: number }> = [];
  let buf: string[] = [];
  // Track block-comment depth across lines (T-SQL allows nested /* */).
  let blockDepth = 0;

  const isGoLine = (line: string): { go: boolean; count: number } => {
    // GO only counts when the line — outside any block comment — is just
    // `GO` with optional whitespace and an optional repeat count.
    if (blockDepth > 0) return { go: false, count: 1 };
    const m = line.match(/^\s*GO\s*(\d+)?\s*(?:--.*)?$/i);
    if (!m) return { go: false, count: 1 };
    return { go: true, count: m[1] ? Math.max(1, parseInt(m[1], 10)) : 1 };
  };

  // Update blockDepth for a line (rough scan; good enough to keep a stray
  // GO inside /* */ from splitting).
  const scanBlock = (line: string) => {
    let i = 0;
    while (i < line.length) {
      if (blockDepth > 0) {
        const close = line.indexOf("*/", i);
        if (close === -1) return;
        blockDepth -= 1;
        i = close + 2;
      } else {
        const open = line.indexOf("/*", i);
        const lineComment = line.indexOf("--", i);
        if (open === -1) return;
        if (lineComment !== -1 && lineComment < open) return; // rest is // comment
        blockDepth += 1;
        i = open + 2;
      }
    }
  };

  for (const line of lines) {
    const { go, count } = isGoLine(line);
    if (go) {
      const sql = buf.join("\n").trim();
      if (sql) out.push({ sql, count });
      buf = [];
      continue;
    }
    buf.push(line);
    scanBlock(line);
  }
  const tail = buf.join("\n").trim();
  if (tail) out.push({ sql: tail, count: 1 });
  return out;
}

// One type-name part: a regular identifier or a bracketed one (no `]` inside,
// so it can't close the bracket early).
const TYPE_PART = String.raw`(?:\[[A-Za-z_][\w ]*\]|[A-Za-z_]\w*)`;
const DATA_TYPE_RE = new RegExp(
  String.raw`^(?:${TYPE_PART}\.)?${TYPE_PART}(?:\s+(?:precision|varying))?` +
    String.raw`(?:\s*\(\s*(?:\d+|max)\s*(?:,\s*\d+\s*)?\))?$`,
  "i",
);

/**
 * A column / alias base type: `int`, `nvarchar(max)`, `decimal(18, 2)`,
 * `dbo.MyType`, `[my type]`, `double precision`. Anything else — including a
 * second statement tacked on after the type — is rejected.
 */
export function requireSqlServerDataType(value: string, fieldName: string): string {
  const v = value.trim();
  if (!DATA_TYPE_RE.test(v)) {
    throw new Error(`${fieldName} "${v}" is not a valid SQL Server data type`);
  }
  return v;
}

const OBJECT_PART = String.raw`(?:\[[^\]\r\n]+\]|[A-Za-z_@#][\w@#$]*)`;
const OBJECT_NAME_RE = new RegExp(String.raw`^(?:${OBJECT_PART}?\.){0,3}${OBJECT_PART}$`);

/** A 1- to 4-part object reference (`server.db.schema.obj`, `db..obj`, `[a b].c`). */
export function requireSqlServerObjectName(value: string, fieldName: string): string {
  const v = value.trim();
  if (!OBJECT_NAME_RE.test(v)) {
    throw new Error(`${fieldName} "${v}" is not a valid 1- to 4-part object name`);
  }
  return v;
}

/**
 * A DEFAULT expression, spliced as `DEFAULT (<expr>)`. The splice is safe as
 * long as the expression can never close that outer parenthesis: then anything
 * the author writes stays inside it and is at worst a syntax error, never a
 * second statement. So: strings and brackets must close, parentheses must
 * balance without ever dipping below zero, and no comment may swallow the
 * closing `)`.
 */
export function requireSqlServerDefaultExpression(value: string, fieldName: string): string {
  const v = value.trim();
  const bad = (why: string) => new Error(`${fieldName} ${why}`);
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === "'" || ch === "[" || ch === '"') {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      for (;;) {
        if (j >= v.length) throw bad("has an unterminated quote");
        if (v[j] === close) {
          if (v[j + 1] === close) { j += 2; continue; } // '' / ]] / "" escape
          break;
        }
        j++;
      }
      i = j;
      continue;
    }
    if ((ch === "-" && v[i + 1] === "-") || (ch === "/" && v[i + 1] === "*")) {
      throw bad("cannot contain comments");
    }
    if (ch === ";") throw bad("cannot contain ';'");
    if (ch === "(") depth++;
    if (ch === ")" && --depth < 0) throw bad("has an unbalanced ')'");
  }
  if (depth !== 0) throw bad("has an unbalanced '('");
  return v;
}
