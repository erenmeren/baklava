/**
 * In-browser usage history for the pod / node tables and the overview. No
 * persistence: samples accumulate while the page is open and are lost on
 * reload — the same contract as the Kafka cluster pulse.
 */
import { parseCpu } from "./usage";

/** Samples kept per series. At the workspace's 5s refresh, 60 ≈ 5 minutes. */
export const HISTORY_SIZE = 60;

export type History = Record<string, number[]>;

const MEM_UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };

/** Inverse of usage.ts `formatMemory` ("12.5 MiB" → bytes); null for "—". */
export function parseFormattedMemory(s: string | null | undefined): number | null {
  const m = s?.match(/^(\d+(?:\.\d+)?) (B|KiB|MiB|GiB|TiB)$/);
  return m ? Number(m[1]) * MEM_UNITS[m[2]] : null;
}

/** Formatted CPU ("28m", "2.5") → millicores; null for "—". */
export function parseFormattedCpu(s: string | null | undefined): number | null {
  return parseCpu(s ?? undefined);
}

/**
 * Append one sample per key, trimming each series to `size`. Series whose key
 * is absent from `samples` are dropped (the row is gone); a null sample keeps
 * the series but adds nothing.
 */
export function appendSamples(
  prev: History,
  samples: Record<string, number | null>,
  size = HISTORY_SIZE,
): History {
  const next: History = {};
  for (const [key, value] of Object.entries(samples)) {
    const series = prev[key] ?? [];
    next[key] = value === null ? series : [...series, value].slice(-size);
  }
  return next;
}

/** "last 3m" for the history label, given samples taken every `intervalMs`. */
export function historyMinutes(samples: number, intervalMs: number): number {
  return Math.max(1, Math.ceil((samples * intervalMs) / 60_000));
}
