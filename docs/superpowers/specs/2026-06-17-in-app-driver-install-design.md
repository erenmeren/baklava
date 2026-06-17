# In-App Driver Install — Design

**Date:** 2026-06-17
**Status:** Approved (design); ready for implementation planning
**Builds on:** `docs/superpowers/specs/2026-06-16-tech-module-plugin-architecture-design.md`

## Problem

The tech-module architecture made every backend driver an `optionalDependency`
that is lazy-imported and externalized (loaded from `node_modules` at runtime via
`serverExternalPackages`, not bundled). A user who runs `npm install --omit=optional`
(or otherwise lacks a driver) sees that tech dimmed as "not installed" on the home
grid. Today the only fix is to drop to a terminal and `npm install` the packages by
hand.

Deliver the user-facing half of the original idea — *"users can download which
tech they need"* — as an in-app **Install driver** button on not-installed tiles.

## Goal

A not-installed connection tech shows its required packages and an **Install
driver** button. Clicking it installs exactly that tech's declared
`optionalDeps` server-side, streams progress, and re-enables the tile **without a
rebuild or restart** — because externalized packages are loaded from
`node_modules` at runtime, a freshly-installed package is picked up by the
driver's lazy `import()`.

## Non-goals / constraints

- **No arbitrary install.** The client sends only a `techId`; the server derives
  the package list from the registry. The client can never specify package names.
- **Local-only by default.** Installing spawns `npm`, so the endpoint is gated to
  local requests, with an env kill-switch for exposed self-hosted deployments.
- **No uninstall** in this iteration (YAGNI). No package-manager auto-detection —
  use `npm` (the repo's package manager).
- **No rebuild/restart** is required for the installed tech to become usable; the
  one residual risk (Turbopack dev module caching) is verified during
  implementation and surfaced in the UI if it ever needs a manual refresh.

## Architecture

### Security rules (non-negotiable)

1. **Server-derives-packages-from-techId.** `resolveInstallPackages(techId)` looks
   up the tech in the registry and returns its `optionalDeps`. Unknown techId or a
   tech with no `optionalDeps` → throws (→ 400). The client's only input is the
   `techId` path segment.
2. **`isInstallAllowed(req)`** returns true only when the request host is local
   (`localhost` / `127.0.0.1` / `::1`) AND `process.env.BAKLAVA_DISABLE_DRIVER_INSTALL`
   is not set. Non-local or disabled → 403.

Both are pure, exported, unit-tested functions — independent of the route and of
spawning npm.

### Install endpoint — `GET /api/techs/[id]/install` (SSE)

Matches the existing action-triggering SSE routes (`images/build-stream`,
`images/pull-stream`): `runtime = "nodejs"`, `dynamic = "force-dynamic"`, the
`ReadableStream` + `safeEnqueue` + 15s heartbeat + `req.signal` abort teardown
pattern from AGENTS.md.

Flow inside the handler:
1. `isInstallAllowed(req)` → else close with an `error` event + 403-style payload.
2. `packages = resolveInstallPackages(id)` → else `error` event (unknown tech).
3. Concurrency guard: an in-flight `Set<string>` on `globalThis`
   (`Symbol.for("baklava.driverInstalls")`). If `id` is already installing →
   `error` event ("install already in progress"). Add on start, remove in
   `finally`.
4. `spawn("npm", ["install", ...packages], { cwd: process.cwd() })`. Pipe
   stdout/stderr lines as SSE `progress` events.
5. On exit code 0: `invalidatePresence(packages)`, emit `done`
   (`{ installed: packages }`). Non-zero: emit `error` (`{ message }`).

Wire format per AGENTS.md: `event: <name>\ndata: <json>\n\n`.

### Presence invalidation — `src/techs/presence.ts`

Add `invalidatePresence(pkgs?: string[])`: delete the given packages from the
module-level cache `Map` (or clear all when omitted) so the next
`isDriverInstalled` re-runs `require.resolve` against the now-present files.

### Becoming usable without restart

After `done`, the client calls `router.refresh()`. The home page server component
recomputes the installed map; `require.resolve` now succeeds (cache cleared, files
on disk), so the tile re-enables. The driver's lazy `import()` loads the package at
call time. Verified-by-design for `next start`; Turbopack dev caching is the one
implementation-time check.

## UI

### `src/app/page.tsx` (server component)

Already computes `installed: Record<TechId, boolean>`. Extend to also pass:
- `optionalDeps: Record<TechId, string[]>` (from `TECH_META_LIST`), and
- `canInstall: boolean` = `isInstallAllowed`-equivalent computed from `headers()`
  (`host` is local) and the env kill-switch.

### `src/components/tech-grid.tsx` (client)

New props `optionalDeps?` and `canInstall?`. For a connection tile where
`installed[id] === false`:
- show `needs: <optionalDeps.join(", ")>`;
- if `canInstall`, render an **Install driver** button opening the install dialog;
- if `!canInstall`, show the copy-able `npm i <deps>` hint instead (graceful
  fallback for non-local/disabled).

### Install dialog (client)

Imperative `[open, setOpen]` bound to shadcn `Dialog` (base-ui convention). On
open, create an `EventSource` to `/api/techs/<id>/install`, stored in a ref with a
dedicated unmount cleanup (`useEffect(() => () => ref.current?.close(), [])`).
- `progress` events append to a scrolling monospace log.
- `done` → success toast (`sonner`), `router.refresh()`, close, then `source.close()`.
- `error` → render the message, keep the log open, stop the spinner.

## Error handling

- Non-local / disabled → button not shown (server `canInstall`), and the route
  independently 403s (defense in depth).
- Unknown techId → route `error` event.
- npm failure (network, registry, peer conflict) → `error` event with npm's tail
  output; dialog shows it; tile stays not-installed.
- Concurrent install → `error` event.
- `EventSource` drop / unmount → ref cleanup closes it; in-flight guard cleared in
  the route's `finally` on abort.

## Testing

- `resolveInstallPackages`: returns exact `optionalDeps` for a known tech; throws
  for unknown id and for a tech with no `optionalDeps`; never reflects client input.
- `isInstallAllowed`: allow/deny matrix over local/non-local hosts × env set/unset.
- `invalidatePresence`: seeds the presence cache, invalidates, asserts re-check.
- Install route (spawn mocked): emits `progress…done` with `{ installed }` on exit
  0; emits `error` on non-zero exit; 403 path for non-local; 400/`error` for unknown
  tech; concurrency guard rejects a second concurrent call.
- Existing 483 tests stay green; `npm run build` succeeds.

## File structure

- Create: `src/app/api/techs/[id]/install/route.ts` (SSE endpoint).
- Create: `src/lib/techs/install.ts` — `resolveInstallPackages`, `isInstallAllowed`
  (pure, testable; imports the registry, server-only). Tests alongside.
- Modify: `src/techs/presence.ts` — add `invalidatePresence`.
- Modify: `src/app/page.tsx` — pass `optionalDeps` + `canInstall`.
- Modify: `src/components/tech-grid.tsx` — needs-line, install button / copy hint.
- Create: `src/components/install-driver-dialog.tsx` — the SSE-driven dialog.

## Future (unblocked, not built)

- Uninstall / "remove driver". A Settings ▸ Integrations management page. A
  `baklava add <tech>` CLI sharing `resolveInstallPackages`. pnpm/yarn detection.
