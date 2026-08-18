/**
 * Resource-usage quantities from metrics-server.
 *
 * CPU arrives as nanocores ("27848233n") from metrics-server but as
 * millicores ("250m") or whole cores ("2") in specs, and memory carries
 * either binary (Ki/Mi/Gi) or decimal (k/M/G) suffixes. Everything is
 * normalised here — CPU to millicores, memory to bytes — so the callers only
 * ever compare like with like.
 */

const DASH = "—";

const CPU_UNITS: Record<string, number> = {
  n: 1e-6, // nanocores → millicores
  u: 1e-3, // microcores → millicores
  m: 1, // millicores
};

/** CPU quantity → millicores. */
export function parseCpu(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/^(\d+(?:\.\d+)?)([num])?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  // No suffix means whole cores.
  return m[2] ? value * CPU_UNITS[m[2]] : value * 1000;
}

const MEM_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
};

/** Memory quantity → bytes. */
export function parseMemoryBytes(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/^(\d+(?:\.\d+)?)([KMGTP]i|[kMGTP])?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return m[2] ? value * MEM_UNITS[m[2]] : value;
}

/** Millicores → "28m" under a core, "2.5" above it. */
export function formatCpu(millicores: number | null): string {
  if (millicores === null) return DASH;
  if (millicores < 1000) return `${Math.round(millicores)}m`;
  return `${(millicores / 1000).toFixed(1).replace(/\.0$/, "")}`;
}

/** Bytes → the largest sane binary unit. */
export function formatMemory(bytes: number | null): string {
  if (bytes === null) return DASH;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

/** Usage as a whole-number percentage of capacity. */
export function percentOf(usage: number | null, capacity: number | null): number | null {
  if (usage === null || capacity === null || capacity <= 0) return null;
  return Math.round((usage / capacity) * 100);
}
