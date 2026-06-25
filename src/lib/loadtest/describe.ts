// Human-readable descriptions of a load-test configuration. Pure + client-safe
// (no driver / node imports) so the PDF report, the API layer, and UI can all
// share one phrasing. NEVER emit secret values here — auth is described by type
// only, mirroring redactAuth() in store.ts.
import type { LoadProfile, Thresholds } from "./schema";
import type { SavedAuth } from "./store-schema";

/** Short label for the profile kind, e.g. "Constant load". */
export function profileLabel(profile: LoadProfile): string {
  switch (profile.type) {
    case "constant":
      return "Constant load";
    case "ramping":
      return "Ramping VUs";
    case "constantRate":
      return "Constant arrival rate";
    case "rampingRate":
      return "Ramping arrival rate";
    case "baseline":
      return "Baseline";
    case "breakpoint":
      return "Breakpoint";
  }
}

/** One-line description of the load profile, e.g. "10 VUs for 30s". */
export function describeProfile(profile: LoadProfile): string {
  switch (profile.type) {
    case "constant":
      return `${profile.vus} VUs for ${profile.duration}`;
    case "ramping": {
      const stages = profile.stages.map((s) => `${s.target} VUs @ ${s.duration}`).join(" → ");
      return `start ${profile.startVUs} VUs → ${stages}`;
    }
    case "constantRate":
      return `${profile.rate} req/s for ${profile.duration} (≤${profile.preAllocatedVUs} VUs)`;
    case "rampingRate": {
      const stages = profile.stages.map((s) => `${s.target} req/s @ ${s.duration}`).join(" → ");
      return `start ${profile.startRate} req/s → ${stages} (≤${profile.preAllocatedVUs} VUs)`;
    }
    case "baseline":
      return `${profile.rate} req/s for ${profile.duration} (≤${profile.preAllocatedVUs} VUs)`;
    case "breakpoint":
      return `ramp to ${profile.maxRate} req/s over ${profile.duration} (≤${profile.preAllocatedVUs} VUs)`;
  }
}

/** Describe auth by type only — never the secret value. */
export function describeAuth(auth: SavedAuth): string {
  switch (auth.type) {
    case "none":
      return "None";
    case "bearer":
      return "Bearer token";
    case "basic":
      return `Basic (user: ${auth.username || "—"})`;
    case "apiKey":
      return `API key (header: ${auth.header})`;
    case "customHeaders": {
      const keys = Object.keys(auth.headers);
      return keys.length ? `Custom headers (${keys.join(", ")})` : "Custom headers";
    }
  }
}

/** Lines describing the configured pass/fail thresholds, empty if none set. */
export function describeThresholds(thresholds: Thresholds): string[] {
  if (!thresholds) return [];
  const out: string[] = [];
  if (thresholds.p95 != null) out.push(`p95 < ${thresholds.p95}ms`);
  if (thresholds.p99 != null) out.push(`p99 < ${thresholds.p99}ms`);
  if (thresholds.errorRate != null) out.push(`error rate < ${(thresholds.errorRate * 100).toFixed(2)}%`);
  if (thresholds.minRps != null) out.push(`throughput ≥ ${thresholds.minRps} req/s`);
  return out;
}
