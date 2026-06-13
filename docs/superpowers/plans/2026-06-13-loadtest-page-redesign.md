# Load Testing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped load-test right Sheet with a dedicated `/loadtest` page flow and rebuild the request editor as a Postman-style builder so HTTP method + body are first-class.

**Architecture:** Home tile (`kind === "tool"`) navigates to a new `/loadtest` index page (card grid of saved tests) instead of opening a Sheet. Creation lives at `/loadtest/new`, editing stays at `/loadtest/[testId]/config`; both reuse `LoadTestForm`, now laid out in two columns. The request card is rewritten with an always-visible color-coded method select + path, and `Headers / Body / Checks` tabs. No backend, schema, API, or `form-serialize.ts` changes — the k6 engine already handles every method and body.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/base-ui (`Tabs`, `Select`, `Card`), Vitest + Testing Library.

---

## File Structure

- `src/app/loadtest/request-card.tsx` — **rewrite**: Postman-style row + tabs.
- `src/app/loadtest/request-card.dom.test.tsx` — **create**: method→body-tab behavior.
- `src/app/loadtest/loadtest-form.tsx` — **modify**: two-column layout (presentational only).
- `src/components/loadtest/loadtest-index.tsx` — **create**: card-grid list for the index page.
- `src/app/loadtest/page.tsx` — **create**: `/loadtest` index server page.
- `src/app/loadtest/new/page.tsx` — **create**: `/loadtest/new` creation page.
- `src/components/tech-grid.tsx` — **modify**: route tool tiles to `/loadtest`, drop the Sheet.
- `src/components/loadtest-sheet.tsx` — **delete**.
- `src/components/loadtest-list.tsx` — **delete** (replaced by `loadtest-index.tsx`).

---

## Task 1: Rewrite the request card as a Postman-style builder

**Files:**
- Modify (full rewrite): `src/app/loadtest/request-card.tsx`
- Test (create): `src/app/loadtest/request-card.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/loadtest/request-card.dom.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RequestCard } from "./request-card";
import type { HttpMethod, RequestForm } from "./form-serialize";

function renderCard(method: HttpMethod) {
  const req: RequestForm = {
    name: "r1", method, path: "/x", headers: [], body: "",
    checkStatus: "", checkBodyContains: "", thinkTime: "",
  };
  return render(
    <RequestCard
      req={req}
      index={0}
      expanded
      onToggle={() => {}}
      onChange={() => {}}
      onRemove={() => {}}
      onMove={() => {}}
      canRemove
    />,
  );
}

describe("RequestCard", () => {
  it("shows the method and path without expanding logic hiding them", () => {
    renderCard("POST");
    // method select renders its value; path input carries the value
    expect(screen.getByDisplayValue("/x")).toBeInTheDocument();
  });

  it("disables the Body tab for GET", () => {
    renderCard("GET");
    expect(screen.getByRole("tab", { name: /body/i })).toBeDisabled();
  });

  it("enables the Body tab for POST", () => {
    renderCard("POST");
    expect(screen.getByRole("tab", { name: /body/i })).not.toBeDisabled();
  });

  it("disables the Body tab for HEAD", () => {
    renderCard("HEAD");
    expect(screen.getByRole("tab", { name: /body/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/loadtest/request-card.dom.test.tsx`
Expected: FAIL (no `role="tab"` yet — current card has no tabs).

- [ ] **Step 3: Rewrite `request-card.tsx`**

Replace the entire contents of `src/app/loadtest/request-card.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HeaderRow, HttpMethod, RequestForm } from "./form-serialize";
import { HeaderRows } from "./auth-fields";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-blue-600 dark:text-blue-400",
  PUT: "text-amber-600 dark:text-amber-400",
  PATCH: "text-violet-600 dark:text-violet-400",
  DELETE: "text-destructive",
  HEAD: "text-muted-foreground",
  OPTIONS: "text-muted-foreground",
};

const BODYLESS = new Set<HttpMethod>(["GET", "HEAD"]);

export function RequestCard({
  req,
  index,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onMove,
  canRemove,
}: {
  req: RequestForm;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<RequestForm>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canRemove: boolean;
}) {
  const bodyless = BODYLESS.has(req.method);
  const [tab, setTab] = useState("headers");

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Collapse request" : "Expand request"}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <Select value={req.method} onValueChange={(v) => onChange({ method: v as HttpMethod })}>
          <SelectTrigger
            className={cn("w-[108px] font-mono text-xs font-semibold", METHOD_COLOR[req.method])}
            aria-label="HTTP method"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m} className={cn("font-mono font-semibold", METHOD_COLOR[m])}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={req.path}
          onChange={(e) => onChange({ path: e.target.value })}
          placeholder="/api/items"
          aria-label="Request path"
          className="flex-1 font-mono text-xs"
        />

        <Input
          value={req.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={`request ${index + 1}`}
          aria-label="Request name"
          className="w-40 text-xs hidden md:block"
        />

        <Button type="button" size="icon" variant="ghost" onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} disabled={!canRemove} aria-label="Remove">
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3">
          <Input
            value={req.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={`request ${index + 1}`}
            aria-label="Request name (mobile)"
            className="text-xs md:hidden"
          />

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="headers">Headers</TabsTrigger>
              <TabsTrigger value="body" disabled={bodyless}>Body</TabsTrigger>
              <TabsTrigger value="checks">Checks</TabsTrigger>
            </TabsList>

            <TabsContent value="headers" className="pt-3">
              <HeaderRows rows={req.headers} onChange={(headers: HeaderRow[]) => onChange({ headers })} />
            </TabsContent>

            <TabsContent value="body" className="pt-3">
              <Textarea
                value={req.body}
                onChange={(e) => onChange({ body: e.target.value })}
                rows={5}
                placeholder='{"key":"value"}'
                className="font-mono text-xs"
              />
            </TabsContent>

            <TabsContent value="checks" className="pt-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Check status</Label>
                  <Input value={req.checkStatus} onChange={(e) => onChange({ checkStatus: e.target.value })} placeholder="200" />
                </div>
                <div className="space-y-1">
                  <Label>Body contains</Label>
                  <Input value={req.checkBodyContains} onChange={(e) => onChange({ checkBodyContains: e.target.value })} placeholder="ok" />
                </div>
                <div className="space-y-1">
                  <Label>Think time (s)</Label>
                  <Input value={req.thinkTime} onChange={(e) => onChange({ thinkTime: e.target.value })} placeholder="0" />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {bodyless ? (
            <p className="text-xs text-muted-foreground">{req.method} requests usually have no body.</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/loadtest/request-card.dom.test.tsx`
Expected: PASS (4 tests).

If `getByRole("tab", …)` does not match, inspect the rendered output of `src/components/ui/tabs.tsx` and adjust the query to the actual role/attribute base-ui emits (it should be `role="tab"` with `disabled`).

- [ ] **Step 5: Commit**

```bash
git add src/app/loadtest/request-card.tsx src/app/loadtest/request-card.dom.test.tsx
git commit -m "feat(loadtest): Postman-style request builder with method-aware body tab"
```

---

## Task 2: Two-column layout for `LoadTestForm`

**Files:**
- Modify: `src/app/loadtest/loadtest-form.tsx` (the returned JSX only — keep all state/handlers/`save`)

- [ ] **Step 1: Replace the `return (...)` block**

In `src/app/loadtest/loadtest-form.tsx`, replace the entire `return (` JSX (lines starting at `return (` through the final `);`) with this. Do **not** change any logic above it (`save`, `patchRequest`, `moveRequest`, state):

```tsx
  return (
    <div className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5 space-y-4">
            <div className="space-y-1">
              <Label>Test name</Label>
              <Input value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} placeholder="Checkout flow" />
            </div>
            <div className="space-y-1">
              <Label>Base URL</Label>
              <Input value={state.target.baseUrl} onChange={(e) => setState((s) => ({ ...s, target: { ...s.target, baseUrl: e.target.value } }))} placeholder="https://api.example.com" />
            </div>
            <div className="space-y-1">
              <Label>Default headers</Label>
              <HeaderRows rows={state.target.headers} onChange={(headers) => setState((s) => ({ ...s, target: { ...s.target, headers } }))} />
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Requests</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setState((s) => ({ ...s, requests: [...s.requests, emptyRequest()] }))}>
                <Plus className="size-3.5" />
                Add request
              </Button>
            </div>
            <div className="space-y-2">
              {state.requests.map((req, i) => (
                <RequestCard
                  key={i}
                  req={req}
                  index={i}
                  expanded={expanded === i}
                  onToggle={() => setExpanded((cur) => (cur === i ? -1 : i))}
                  onChange={(patch) => patchRequest(i, patch)}
                  onRemove={() => setState((s) => ({ ...s, requests: s.requests.filter((_, idx) => idx !== i) }))}
                  onMove={(dir) => moveRequest(i, dir)}
                  canRemove={state.requests.length > 1}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5"><AuthFields auth={state.auth} editing={editing} onChange={(auth) => setState((s) => ({ ...s, auth }))} /></Card>

          <Card className="p-5"><ProfileFields profile={state.profile} onChange={(profile) => setState((s) => ({ ...s, profile }))} /></Card>

          <Card className="p-5 space-y-3">
            <h3 className="font-semibold text-sm">Thresholds (optional)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>p95 (ms)</Label><Input value={state.thresholds.p95} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, p95: e.target.value } }))} /></div>
              <div className="space-y-1"><Label>p99 (ms)</Label><Input value={state.thresholds.p99} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, p99: e.target.value } }))} /></div>
              <div className="space-y-1"><Label>Error rate (0–1)</Label><Input value={state.thresholds.errorRate} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, errorRate: e.target.value } }))} placeholder="0.01" /></div>
              <div className="space-y-1"><Label>Min RPS</Label><Input value={state.thresholds.minRps} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, minRps: e.target.value } }))} /></div>
            </div>
          </Card>

          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {editing ? "Save changes" : "Create test"}
          </Button>
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/app/loadtest/loadtest-form.tsx`
Expected: no errors. (All imports — `Card`, `Button`, `Input`, `Label`, `Alert*`, `Loader2`, `Plus`, `Save`, `HeaderRows`, `AuthFields`, `ProfileFields`, `RequestCard`, `emptyRequest` — are already imported in the file and remain used.)

- [ ] **Step 3: Commit**

```bash
git add src/app/loadtest/loadtest-form.tsx
git commit -m "feat(loadtest): two-column form layout for full-page use"
```

---

## Task 3: `/loadtest` index page (card grid)

**Files:**
- Create: `src/components/loadtest/loadtest-index.tsx`
- Create: `src/app/loadtest/page.tsx`

- [ ] **Step 1: Create the index client component**

Create `src/components/loadtest/loadtest-index.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Plus, Trash2, Play, Pencil } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/loadtest/status-pill";
import type { PublicLoadTest } from "@/lib/loadtest/store";

function methodMix(t: PublicLoadTest): string {
  const counts: Record<string, number> = {};
  for (const r of t.config.requests) counts[r.method] = (counts[r.method] ?? 0) + 1;
  return Object.entries(counts)
    .map(([m, n]) => (n > 1 ? `${m}·${n}` : m))
    .join("  ");
}

export function LoadTestIndex() {
  const [tests, setTests] = useState<PublicLoadTest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/loadtest", { cache: "no-store" });
        const data = (await res.json()) as { loadtests: PublicLoadTest[] };
        if (active) setTests(data.loadtests ?? []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const remove = async (id: string) => {
    const res = await fetch(`/api/loadtest/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTests((t) => t.filter((x) => x.id !== id));
      toast.success("Test deleted");
    } else {
      toast.error("Delete failed");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 pt-6 pb-12 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Load Testing</h1>
          <p className="text-sm text-muted-foreground">Define and run k6 load tests against any REST API.</p>
        </div>
        <Link href="/loadtest/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-3.5" />
          New test
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tests.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No saved tests yet — click <span className="font-medium text-foreground">New test</span> to add one.
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tests.map((t) => (
            <Card key={t.id} className="p-4 flex flex-col gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{t.name}</div>
                <div className="text-xs text-muted-foreground truncate">{t.config.target.baseUrl}</div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground truncate">{methodMix(t)}</span>
                {t.lastRun ? <StatusPill status={t.lastRun.status} /> : <span className="text-[11px] text-muted-foreground">no runs</span>}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Link href={`/loadtest/${t.id}/run`} className={buttonVariants({ size: "sm", variant: "default", className: "flex-1" })}>
                  <Play className="size-3.5" />
                  Run
                </Link>
                <Link href={`/loadtest/${t.id}/config`} className={buttonVariants({ size: "sm", variant: "outline" })} aria-label="Edit test">
                  <Pencil className="size-3.5" />
                </Link>
                <Button size="icon" variant="ghost" onClick={() => remove(t.id)} aria-label="Delete test">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the index server page**

Create `src/app/loadtest/page.tsx`:

```tsx
import { LoadTestIndex } from "@/components/loadtest/loadtest-index";

export const dynamic = "force-dynamic";

export default function LoadTestIndexPage() {
  return <LoadTestIndex />;
}
```

- [ ] **Step 3: Verify `buttonVariants` accepts a `className` arg**

Run: `grep -n "buttonVariants" src/components/ui/button.tsx`
Expected: `buttonVariants` is exported from `class-variance-authority` `cva(...)`. CVA accepts `{ size, variant, className }` and merges `className`. If your shadcn `button.tsx` wraps differently and does not accept `className`, replace `buttonVariants({ size: "sm", variant: "default", className: "flex-1" })` with `cn(buttonVariants({ size: "sm" }), "flex-1")` and import `cn` from `@/lib/utils`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/loadtest/loadtest-index.tsx src/app/loadtest/page.tsx
git commit -m "feat(loadtest): /loadtest index page with saved-test card grid"
```

---

## Task 4: `/loadtest/new` creation page

**Files:**
- Create: `src/app/loadtest/new/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/loadtest/new/page.tsx`:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LoadTestForm } from "@/app/loadtest/loadtest-form";

export const dynamic = "force-dynamic";

export default function NewLoadTestPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pt-6 pb-12 space-y-6">
      <div className="space-y-2">
        <Link href="/loadtest" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Load tests
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">New load test</h1>
          <p className="text-sm text-muted-foreground">Configure target, requests, auth, and load profile.</p>
        </div>
      </div>
      <LoadTestForm />
    </div>
  );
}
```

Note: `LoadTestForm` with no `initial` is in create mode; on save it `router.push`es to `/loadtest/${id}/run` (existing behavior). `/loadtest/new` is a static sibling of `[testId]`, so Next.js resolves it before the dynamic segment and it never hits `requireLoadTest("new")`.

- [ ] **Step 2: Verify routing precedence + typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. The route tree now has `loadtest/page.tsx`, `loadtest/new/page.tsx`, and `loadtest/[testId]/...` as siblings.

- [ ] **Step 3: Commit**

```bash
git add src/app/loadtest/new/page.tsx
git commit -m "feat(loadtest): /loadtest/new full-page creation form"
```

---

## Task 5: Route tool tiles to `/loadtest` and delete the Sheet

**Files:**
- Modify: `src/components/tech-grid.tsx`
- Delete: `src/components/loadtest-sheet.tsx`
- Delete: `src/components/loadtest-list.tsx`

- [ ] **Step 1: Edit `tech-grid.tsx` — imports & router**

In `src/components/tech-grid.tsx`:

1. Remove the import line:
```tsx
import { LoadTestSheet } from "@/components/loadtest-sheet";
```
2. Add a router import near the top (after the React import):
```tsx
import { useRouter } from "next/navigation";
```
3. Inside `export function TechGrid() {`, remove:
```tsx
  const [loadtestOpen, setLoadtestOpen] = useState(false);
```
and add:
```tsx
  const router = useRouter();
```

- [ ] **Step 2: Edit the tile click handler**

Replace:
```tsx
              onClick={() => (tech.kind === "tool" ? setLoadtestOpen(true) : setOpenTech(tech))}
```
with:
```tsx
              onClick={() => (tech.kind === "tool" ? router.push("/loadtest") : setOpenTech(tech))}
```

- [ ] **Step 3: Remove the Sheet element**

Delete this line near the end of the JSX:
```tsx
      <LoadTestSheet open={loadtestOpen} onOpenChange={setLoadtestOpen} />
```

- [ ] **Step 4: Delete the dead components**

```bash
git rm src/components/loadtest-sheet.tsx src/components/loadtest-list.tsx
```

- [ ] **Step 5: Confirm no dangling references**

Run: `grep -rn "loadtest-sheet\|LoadTestSheet\|loadtest-list\|LoadTestList" src`
Expected: no output.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/tech-grid.tsx`
Expected: no errors (`useState` is still used for `counts`, `filter`, `openTech`; keep its import).

- [ ] **Step 7: Commit**

```bash
git add src/components/tech-grid.tsx
git commit -m "feat(loadtest): navigate to /loadtest from home tile; remove Sheet"
```

---

## Task 6: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Test suite**

Run: `npm test`
Expected: all pass, including the new `request-card.dom.test.tsx` (4 tests). Existing `form-serialize.test.ts` must still pass unchanged (no serialize logic touched).

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds; route list shows `/loadtest`, `/loadtest/new`, and `/loadtest/[testId]/...`.

- [ ] **Step 5: Manual smoke (optional but recommended)**

```bash
npm run dev
```
Then: home → click the Load Testing tile → lands on `/loadtest` (not a sheet). Click **New test** → `/loadtest/new`. Add a request, switch method to **POST** → Body tab enabled; switch to **GET** → Body tab disabled with hint. Create → redirects to `/loadtest/<id>/run`. Back at `/loadtest`, the card shows the method mix and a Run/Edit/Delete row.

- [ ] **Step 6: Final commit (if any uncommitted verification fixes)**

```bash
git add -A && git commit -m "chore(loadtest): verification fixes" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** routing table (Tasks 3–5), two-column form (Task 2), Postman builder + method-aware body (Task 1), deletions (Task 5), "no backend/schema/serialize changes" (honored — only presentational files touched). ✅
- **Type consistency:** `RequestForm`/`HttpMethod`/`HeaderRow` come from `form-serialize.ts` unchanged; `RequestCard` prop shape is identical to the original (`req,index,expanded,onToggle,onChange,onRemove,onMove,canRemove`), so `loadtest-form.tsx`'s call site needs no change. `PublicLoadTest`/`StatusPill`/`RunStatus` reused as-is.
- **No placeholders.** Every code step is complete.
- **Risk note:** the only base-ui uncertainty is the `role="tab"` query in Task 1 Step 4 — fallback instructions included.
