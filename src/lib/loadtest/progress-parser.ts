/**
 * Parse a k6 periodic status line (emitted to stderr when not --quiet and not a
 * TTY), e.g. "running (3.0s), 02/02 VUs, 45 complete and 0 interrupted iterations".
 * Returns the current active VU count and completed-iteration count when present.
 */
export function parseK6Progress(line: string): { vus?: number; iterations?: number } {
  const out: { vus?: number; iterations?: number } = {};
  const vus = line.match(/(\d+)\/(\d+)\s+VUs/);
  if (vus) out.vus = Number(vus[1]);
  const iters = line.match(/(\d+)\s+complete/);
  if (iters) out.iterations = Number(iters[1]);
  return out;
}
