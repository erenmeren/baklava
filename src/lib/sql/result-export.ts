// Shared result-set export helpers for the SQL editors (Postgres + SQL Server).
// Pure string builders + a browser download helper, kept dialect-agnostic so
// both editors render the same Copy / CSV / JSON affordances.

export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeCsv(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCSV(fields: string[], rows: unknown[][]): string {
  const head = fields.map((f) => escapeCsv(f)).join(",");
  const body = rows
    .map((r) => r.map((c) => escapeCsv(cellToString(c))).join(","))
    .join("\n");
  return body ? `${head}\n${body}` : head;
}

/** Tab-separated — the clipboard format that pastes cleanly into spreadsheets. */
export function rowsToTSV(fields: string[], rows: unknown[][]): string {
  const clean = (s: string) => s.replace(/[\t\n\r]+/g, " ");
  const head = fields.map(clean).join("\t");
  const body = rows
    .map((r) => r.map((c) => clean(cellToString(c))).join("\t"))
    .join("\n");
  return body ? `${head}\n${body}` : head;
}

export function rowsToJSON(fields: string[], rows: unknown[][]): string {
  const objs = rows.map((r) => {
    const o: Record<string, unknown> = {};
    fields.forEach((f, i) => {
      o[f] = r[i] ?? null;
    });
    return o;
  });
  return JSON.stringify(objs, null, 2);
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
