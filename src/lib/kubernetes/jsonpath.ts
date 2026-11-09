/**
 * A deliberately tiny JSONPath subset for CRD `additionalPrinterColumns`:
 * `.a.b[0].c` and `['dotted.key']` segments, nothing else. Filters,
 * wildcards, recursive descent and unions are unsupported and evaluate to
 * `undefined`, which the table renders as "—". Only own properties are
 * followed, so a path can't walk into `__proto__` / `constructor`.
 */

const SEGMENT = /\.([A-Za-z0-9_-]+)|\[(\d+)\]|\['([^'\]]*)'\]/y;

/** Parse a path into keys, or null when it uses anything outside the subset. */
export function parseJsonPath(path: string): Array<string | number> | null {
  // kubectl accepts the template form too: `{.spec.replicas}`.
  const p = path.trim().replace(/^\{(.*)\}$/, "$1");
  if (!p.startsWith(".") && !p.startsWith("[")) return null;
  const out: Array<string | number> = [];
  SEGMENT.lastIndex = 0;
  while (SEGMENT.lastIndex < p.length) {
    const at = SEGMENT.lastIndex;
    const m = SEGMENT.exec(p);
    if (!m || m.index !== at) return null;
    out.push(m[2] !== undefined ? Number(m[2]) : (m[1] ?? m[3]));
  }
  return out;
}

export function evalJsonPath(obj: unknown, path: string): unknown {
  const keys = parseJsonPath(path);
  if (!keys) return undefined;
  let cur: unknown = obj;
  for (const k of keys) {
    if (typeof k === "number") {
      if (!Array.isArray(cur) || k >= cur.length) return undefined;
      cur = cur[k];
    } else {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
      if (!Object.hasOwn(cur, k)) return undefined;
      cur = (cur as Record<string, unknown>)[k];
    }
  }
  return cur;
}
