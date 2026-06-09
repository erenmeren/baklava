# Health Dashboard ("Mission Control") — Design

**Date:** 2026-06-09
**Status:** Approved (design)
**Author:** eren + Claude

## Summary

Baklava is broad horizontally — 11 tech workspaces (Docker, Kafka, Postgres,
MySQL, SQL Server, Kubernetes, Redis, Mongo, R2, MinIO, S3), each modeled on its
dedicated tool. Every workspace is **object-browsing**. There is no
cross-connection "is everything OK?" view.

This feature adds a dedicated `/dashboard` route — a live status grid showing,
for every connection at once, reachability plus a few headline metrics, with
sparklines built from poll history. It turns Baklava from "N separate tools"
into a single mission-control surface.

## Confirmed decisions

| Decision | Choice |
| --- | --- |
| Placement | New top-level `/dashboard` route. Home tile grid unchanged. Reachable from a new header icon + ⌘K. |
| Refresh | Interval polling, ~5s, while the tab is visible; paused when hidden. Sparklines from the last N samples. |
| Metric depth | **Tiered** — reachability + latency for all techs; rich headline metrics for the big 4 (Docker, Postgres, Redis, Kafka); status + one summary stat for the rest. |
| Interactivity | Click-through, **view-only**. No mutations from the dashboard (no permission/confirm machinery). |

## Architecture

### `src/lib/connections/health.ts` (new)

The single source of health probing.

```ts
export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthMetric {
  label: string;        // "CPU", "Connections", "Memory"
  value: string;        // pre-formatted display value, e.g. "42%", "18/100"
  hint?: string;        // optional secondary, e.g. "2.4 GB"
}

export interface HealthSnapshot {
  status: HealthStatus;
  latencyMs: number;
  summary: string;                  // one-line, e.g. "8 containers · 3 running"
  metrics: HealthMetric[];          // tier-dependent; [] for reachability-only
  primary?: { label: string; value: number; max?: number }; // drives sparkline
  error?: string;                   // formatError() output when status === "down"
}

export async function probeHealth(conn: ConnectionRecord): Promise<HealthSnapshot>;
```

- `probeHealth` dispatches on `conn.tech`.
- Each per-tech probe follows the established driver lifecycle
  (connect → try → finally disconnect) and runs under a **6s timeout**
  (matches the existing `connectionTimeoutMillis`).
- A thrown/timed-out probe → `status: "down"` with `error` from `formatError`.
- Reuses existing helpers where they exist (notably Postgres
  `getServerOverview`) and `connectionSummaries` for the summary line.

### `src/app/api/dashboard/[id]/health/route.ts` (new)

```ts
export const runtime = "nodejs";
// GET — one connection's snapshot
```

- Resolves the record with `getConnection(id)` from
  `src/lib/connections/store.ts` (the URL carries only the id, not the tech, so
  `requireConnection(id, tech)` is not usable here — use `getConnection` and
  404 via `notFound()`/404 response if missing).
- Calls `probeHealth(record)`, returns the snapshot as JSON.
- Never returns secrets — it only ever returns the computed `HealthSnapshot`.

### `src/app/dashboard/page.tsx` + `dashboard-client.tsx` (new)

- `page.tsx`: server component, exports `metadata` (`title: "Dashboard · Baklava"`),
  renders `<DashboardClient />`.
- `dashboard-client.tsx` (`"use client"`): fetches `/api/connections` **once**,
  renders the summary bar and the responsive card grid, owns a lifted
  `Record<connId, HealthStatus>` map so the summary bar can aggregate.

### `src/components/dashboard-trigger.tsx` (new)

- Mirrors `settings-trigger.tsx`: a `Link` to `/dashboard` styled as a header
  icon button, `LayoutDashboard` icon (lucide).
- Wired into `src/app/layout.tsx` header controls, beside `SettingsTrigger`.
- Added to the ⌘K command palette nav catalog.

## Components (each one job)

- **`DashboardClient`** — connection list fetch, summary bar, grid, lifted
  status map.
- **`HealthCard`** — owns its **own** polling loop (5s, visibility-gated,
  abort-on-unmount), a ring buffer of the last ~30 samples, status pill,
  sparkline, click-through. Reports its current status up via callback.
- **`Sparkline`** — dependency-free inline SVG from the sample history.
- **`StatusDot`** — colored dot for ok/degraded/down, reused in card + summary.

## Metric tiers

| Tech | Headline metrics |
| --- | --- |
| **Docker** | CPU %, mem used, running/total containers |
| **Postgres** | active/max connections (`getServerOverview`), DB size |
| **Redis** | used/max memory, ops/sec, connected clients |
| **Kafka** | total consumer lag, # consumer groups |
| mysql / sqlserver | status + threads/connections summary |
| kubernetes | status + node/pod-ready summary |
| mongo | status + # databases |
| r2 / minio / s3 | status + # buckets |

The card's `primary` metric (a single numeric with optional max) drives the
sparkline: Docker→CPU%, Postgres→connections, Redis→memory%, Kafka→lag, others→
latency.

## Status thresholds (defaults — documented, not yet user-tunable)

- **down** — probe threw or exceeded the 6s timeout.
- **degraded** — reachable but latency > **500ms**, OR a tech warning:
  - Postgres: active connections > 80% of max.
  - Redis: used memory > 85% of maxmemory (only when maxmemory is set).
- **ok** — otherwise.
- Kafka consumer lag is **shown but never triggers degraded** — lag thresholds
  are too workload-specific to guess. (Future: per-connection thresholds.)

## Data flow

1. `/dashboard` loads → `DashboardClient` fetches `/api/connections` (public view).
2. One `HealthCard` per connection.
3. Each `HealthCard` polls `GET /api/dashboard/[id]/health` every 5s (paused when
   `document.hidden`), pushes the sample into its ring buffer, updates pill +
   sparkline, and reports status up.
4. Summary bar aggregates the lifted status map (● healthy ▲ degraded ✕ down).
5. Click a card → `router.push(FIRST_PAGE[tech])` (Kafka → consumer-groups, etc.,
   via the existing `first-page.ts` helper).

## Error handling

- Per-card fetch failure / `down` → red pill + error tooltip; last sparkline
  rendered greyed.
- Abort in-flight fetch on unmount (`abortRef` cleanup, per AGENTS.md).
- Polling paused on `document.hidden`, resumed on `visibilitychange`.
- Empty state: no connections → friendly card linking to the home grid.

## Testing

- **Unit (`health.test.ts`)** — `probeHealth` dispatch + per-tech classification
  with mocked drivers: probe throws → `down`; slow/over-threshold → `degraded`;
  healthy → `ok`. Assert PG >80% and Redis >85% warnings.
- **Route test** — in the existing `tech-test-routes.test.ts` style: 404 on
  unknown id, snapshot shape on success.
- Follows the repo's co-located `*.test.ts` (vitest) convention.

## Reuse / no new dependencies

- Postgres `getServerOverview`, `connectionSummaries`, `FIRST_PAGE`/`first-page.ts`,
  `getConnection`, `formatError`, `settings-trigger.tsx` pattern, shadcn
  `Card`/`Badge` primitives.
- Sparkline is hand-rolled SVG — no charting library.

## Out of scope (YAGNI)

- Quick actions / mutations from the dashboard (restart, flush, kill).
- SSE streaming (polling chosen).
- User-tunable thresholds and refresh interval (defaults documented; can follow).
- Historical persistence — sparklines are in-memory, last ~30 samples only.
- Rich per-tech metrics for the non-big-4 techs.
