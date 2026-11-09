/**
 * Line-based unified diff (LCS), enough for comparing two YAML renderings of
 * one Kubernetes object. Objects are a few hundred lines at most, so the
 * O(n·m) table is fine. Returns "" when the inputs are identical.
 */
export function unifiedDiff(before: string, after: string, context = 3): string {
  if (before === after) return "";
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  type Op = { tag: " " | "-" | "+"; line: string; ai: number; bi: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ tag: " ", line: a[i], ai: i++, bi: j++ });
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      ops.push({ tag: "-", line: a[i], ai: i++, bi: j });
    } else {
      ops.push({ tag: "+", line: b[j], ai: i, bi: j++ });
    }
  }

  // Group changed ops into hunks with `context` lines around them.
  const out: string[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].tag === " ") {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    // Extend while the next change is within 2*context unchanged lines.
    for (;;) {
      while (end < ops.length && ops[end].tag !== " ") end++;
      let gap = end;
      while (gap < ops.length && ops[gap].tag === " ") gap++;
      if (gap < ops.length && gap - end <= context * 2) end = gap;
      else break;
    }
    const stop = Math.min(ops.length, end + context);
    const hunk = ops.slice(start, stop);
    const aLen = hunk.filter((o) => o.tag !== "+").length;
    const bLen = hunk.filter((o) => o.tag !== "-").length;
    const aStart = aLen ? hunk[0].ai + 1 : hunk[0].ai;
    const bStart = bLen ? hunk[0].bi + 1 : hunk[0].bi;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of hunk) out.push(`${o.tag}${o.line}`);
    k = stop;
  }
  return out.join("\n");
}
