import {
  autocompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  schemaCompletionSource,
  type SQLNamespace,
} from "@codemirror/lang-sql";

interface Opts {
  /** Curated keyword list for the dialect (lowercased). */
  keywords: string[];
  /** Curated type names for the dialect (lowercased). */
  types: string[];
  schema?: SQLNamespace;
  defaultSchema?: string;
  upperCaseKeywords?: boolean;
}

/**
 * Build a CompletionSource from a fixed keyword + type list. Mirrors what
 * lang-sql's keywordCompletionSource does internally — read the word at the
 * cursor and emit matching options — but driven by our curated arrays so
 * the popup only suggests dialect-relevant terms (no SQL standard noise).
 */
function makeKeywordSource(
  keywords: string[],
  types: string[],
  upperCase: boolean,
): CompletionSource {
  const xform = (s: string) => (upperCase ? s.toUpperCase() : s);
  const options: Completion[] = [
    ...keywords.map((k) => ({ label: xform(k), type: "keyword" })),
    ...types.map((t) => ({ label: xform(t), type: "type" })),
  ];
  return (ctx) => {
    const word = ctx.matchBefore(/\w*/);
    if (!word) return null;
    if (word.from === word.to && !ctx.explicit) return null;
    return { from: word.from, options, validFor: /^\w*$/ };
  };
}

// Cursor sits where the user is about to write a table name. Match the trailing
// SQL clause + optional partial identifier ("foo.bar", with or without quotes).
const TABLE_CTX_RE =
  /\b(?:from|join|update|into|table|delete\s+from|truncate(?:\s+table)?)\s+[\w."[\]`]*$/i;

/**
 * Replace CodeMirror's default SQL autocompletion with a context-aware source:
 *
 *   - After `FROM` / `JOIN` / `INTO` / `UPDATE` / `TABLE` (and friends), emit
 *     **only** schema items (your tables) — keywords are filtered out, so the
 *     list is short and on-topic instead of dialect noise.
 *   - After a `.` (e.g. `users.`), defer to the schema source so the column
 *     completions for that table show up cleanly.
 *   - Everywhere else, combine schema + dialect keywords with a small boost
 *     on schema items so your real tables/columns outrank generic words.
 *
 * Pair with `basicSetup.autocompletion = false` to avoid double-suggesting.
 */
export function smartSqlCompletions({
  keywords,
  types,
  schema,
  defaultSchema,
  upperCaseKeywords = false,
}: Opts): Extension {
  const kwSrc = makeKeywordSource(keywords, types, upperCaseKeywords);
  const schSrc = schema
    ? schemaCompletionSource({ schema, defaultSchema })
    : null;

  const merge = (
    a: CompletionResult | null,
    b: CompletionResult | null,
  ): CompletionResult | null => {
    if (!a) return b;
    if (!b) return a;
    return {
      from: Math.min(a.from, b.from),
      options: [...a.options, ...b.options],
      validFor: /^[\w."[\]`]*$/,
    };
  };

  // Source is async-typed so we can await the two underlying sources (whose
  // return types are CompletionResult | Promise<…> | null). The built-in
  // sources from lang-sql are synchronous in practice, so this is essentially
  // a no-op at runtime.
  const source: CompletionSource = async (ctx) => {
    const before = ctx.state.doc.sliceString(
      Math.max(0, ctx.pos - 200),
      ctx.pos,
    );
    // After a dot (table.column / schema.table): defer entirely to schema.
    if (/\.\w*$/.test(before) && schSrc) return schSrc(ctx);
    // After FROM / JOIN / etc.: tables only — no keyword noise.
    if (TABLE_CTX_RE.test(before) && schSrc) return schSrc(ctx);
    // Default: combine keywords + schema, with schema items boosted up.
    const kwRes = await kwSrc(ctx);
    const schRes = schSrc ? await schSrc(ctx) : null;
    if (schRes) {
      schRes.options = schRes.options.map((o) => ({
        ...o,
        boost: (o.boost ?? 0) + 5,
      }));
    }
    return merge(kwRes, schRes);
  };

  return autocompletion({ override: [source] });
}
