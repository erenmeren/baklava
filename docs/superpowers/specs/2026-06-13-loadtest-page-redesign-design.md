# Load Testing — page redesign & request builder

**Date:** 2026-06-13
**Status:** Approved (brainstorm)

## Problem

The load-test creation/edit flow is opened from the home tile as a narrow right-side
`Sheet` (`max-w-2xl`). That sheet jams the entire heavy `LoadTestForm` — target,
N request cards, auth, a 6-type profile with multi-stage ramping editors, and
thresholds — into a cramped column, and duplicates the exact same form already
rendered full-page at `/loadtest/[testId]/config`. Users report it as "not useful."

Secondary complaint: the flow "feels GET-only." The data model and backend already
support all 7 HTTP methods **with request bodies** (`http.request(METHOD, url, body,
params)` in `script-gen.ts`), but the method `Select` and body field are buried
inside a request card that is collapsed by default — so users never see them.

## Goals

1. Move creation/editing out of the narrow sheet into a dedicated full-width page.
2. Make HTTP method + body first-class so the flow never reads as GET-only.

## Non-goals (YAGNI)

- No query-param builder (the path already carries the query string).
- No Content-Type dropdown / body-type helper.
- No live k6-script preview.
- **No backend, schema, executor, API, or `form-serialize.ts` changes.** The engine
  already handles every method and body correctly.

## Design

### Routing & navigation

| Route | Status | Purpose |
|---|---|---|
| `/loadtest` | new | Landing page: header + "New test" + grid of saved-test cards |
| `/loadtest/new` | new | Full-width creation form |
| `/loadtest/[testId]/config` | exists | Edit form (same component, full-width) |
| `/loadtest/[testId]/{run,history}` | exists | Unchanged |

- `/loadtest/new` is a **static sibling** of the dynamic `[testId]` segment. Next.js
  resolves static segments before dynamic ones, so `new` never reaches
  `[testId]/layout.tsx` / `requireLoadTest("new")`.
- `tech-grid.tsx`: tiles with `kind === "tool"` render a `Link` to `/loadtest`
  instead of opening the sheet. The `loadtestOpen` state and the `<LoadTestSheet>`
  element are removed.

### Deletions / moves

- **Delete** `src/components/loadtest-sheet.tsx`.
- **Repurpose** `src/components/loadtest-list.tsx` → a card-grid list rendered by the
  `/loadtest` index page (replaces the narrow row list). Each card shows: name, base
  URL, a method-mix badge summary (e.g. `GET POST·3`), last-run `StatusPill`
  (or "no runs"), and Run / Edit / Delete actions.

### Form page layout

The full-width create/edit page uses a two-column responsive layout (single column
on small screens):

- **Main column:** Target (name, base URL, default headers) + **Requests** (the
  Postman builder below).
- **Side column:** Auth, Profile, Thresholds, and a sticky **Create / Save** action bar.

`LoadTestForm` keeps its existing state, validation, and `buildSavedConfig` logic;
only its presentational layout changes. It continues to be reused by both
`/loadtest/new` and `/loadtest/[testId]/config`.

### Postman-style request builder (`request-card.tsx` rewrite)

- **Always-visible header row:** color-coded method `Select` + path `Input` (flex) +
  request name + reorder (up/down) + remove + expand/collapse controls. Method and
  path are never hidden.
  - Method chip colors: GET·green, POST·blue, PUT·amber, PATCH·violet, DELETE·red,
    HEAD/OPTIONS·grey/muted.
- **Expanded body:** shadcn `Tabs` with three tabs — **Headers / Body / Checks** —
  matching the existing `RequestForm` data model.
  - Headers tab: existing `HeaderRows`.
  - Body tab: textarea. **Disabled** with a hint ("GET / HEAD requests usually have
    no body") when method is `GET` or `HEAD`; active otherwise.
  - Checks tab: existing check-status / body-contains / think-time fields.

### What stays identical

- `form-serialize.ts`, `auth-fields.tsx`, `profile-fields.tsx`, thresholds block,
  all of `src/lib/loadtest/*`, all API routes, all SSE/run/history code.

## Testing

- Update `form-serialize.test.ts` only if a serialize path changes (it should not).
- Add/keep a DOM test for the request builder: method change toggles body-tab
  enabled/disabled state; tab switching renders the right fields.
- Verify the `/loadtest` index renders the card grid and `/loadtest/new` renders the
  form; tile click navigates to `/loadtest`.
- Full gate: `npm run lint`, typecheck, `npm test`, `npm run build`.
