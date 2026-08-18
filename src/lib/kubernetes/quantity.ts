/**
 * Shared numeric formatting for the Kubernetes row mappers: ages in seconds
 * and Kubernetes resource quantities in human units.
 */

export function secondsSince(ts: string | Date | undefined, now: Date): number {
  if (!ts) return 0;
  const then = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 1000));
}

/** Kubernetes quantities are Ki/Mi/Gi suffixed; render the largest sane unit. */
/** Placeholder for a value the cluster didn't report. */
const DASH = "—";

export function humanQuantity(raw: string | undefined): string {
  if (!raw) return DASH;
  const m = raw.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)?$/);
  if (!m) return raw;
  const value = Number(m[1]);
  const unit = m[2];
  const bytes =
    unit === "Ki"
      ? value * 1024
      : unit === "Mi"
        ? value * 1024 ** 2
        : unit === "Gi"
          ? value * 1024 ** 3
          : unit === "Ti"
            ? value * 1024 ** 4
            : null;
  if (bytes === null) return raw;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  // Whole values read better without the ".0" — "10 GiB", not "10.0 GiB".
  const rendered = n.toFixed(1).replace(/\.0$/, "");
  return `${rendered} ${units[i]}`;
}
