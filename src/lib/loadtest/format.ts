// Latency values from k6 carry full float precision (e.g. 73.1476253ms), which
// is noise for display. Round to at most 2 decimals; trailing zeros drop
// naturally because the result is a number (73.1476 → 73.15, 73 → 73).
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
