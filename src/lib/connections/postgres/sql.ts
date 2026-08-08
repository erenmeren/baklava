/**
 * Postgres driver — SQL-safety helpers. The leaf module: no imports from
 * any sibling ./postgres/* file.
 */

/** @internal — exported for tests; SQL-safety helpers. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** @internal — exported for tests. */
export function validateIdentifier(name: string, kind: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error(`${kind} name is required`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(
      `${kind} name must start with a letter or underscore and contain only letters, numbers, and underscores`,
    );
  }
  return trimmed;
}

// Reject `;` in free-form SQL fragments (types, default exprs, USING clauses,
// partial-index predicates, function arg signatures). `;` is the only character
// that lets a fragment escape to a second statement in pg's simple-query path.
/** @internal — exported for tests. */
export function requireNoStatementTerminator(value: string, fieldName: string): string {
  if (value.includes(";")) {
    throw new Error(`${fieldName} cannot contain ';'`);
  }
  return value;
}

/**
 * Splits a SQL string into top-level statements on `;`, respecting:
 * - single-quoted strings (with '' escape)
 * - line comments (--…) and block comments (slash-star … star-slash)
 * - dollar-quoted bodies ($$…$$, $tag$…$tag$)
 *
 * Good enough for an interactive SQL editor; not a full grammar.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      buf += c;
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      buf += c;
      if (c === "*" && next === "/") {
        buf += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (inSingle) {
      buf += c;
      if (c === "'" && next === "'") {
        buf += "'";
        i += 2;
        continue;
      }
      if (c === "'") inSingle = false;
      i++;
      continue;
    }

    // Outside any literal/comment.
    if (c === "-" && next === "-") {
      inLineComment = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "$") {
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        dollarTag = m[0];
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (c === ";") {
      const t = buf.trim();
      if (t.length) out.push(t);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const t = buf.trim();
  if (t) out.push(t);
  return out;
}
