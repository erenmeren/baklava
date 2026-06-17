# In-App Driver Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user install a not-installed tech's driver packages from the home grid — server installs exactly that tech's declared `optionalDeps`, streams progress, and re-enables the tile without a rebuild.

**Architecture:** A GET-SSE route `/api/techs/[id]/install` (mirrors the existing `pull-stream` SSE pattern) spawns `npm install <deps>` where the deps are derived server-side from the registry (never client input), gated to local requests. On success it invalidates the presence cache; the client `router.refresh()`es and the tile re-enables (externalized packages load from `node_modules` at runtime via lazy `import()`).

**Tech Stack:** Next.js 16 route handlers + `ReadableStream` SSE, `node:child_process`, React 19 client components, shadcn `Dialog` (base-ui), `sonner`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-in-app-driver-install-design.md`

---

## Decisions locked from the spec (read before coding)

1. **Server-derives-packages-from-techId.** The client sends only the `[id]` path segment. `resolveInstallPackages(id)` returns that tech's `optionalDeps` from the registry, or throws. The client can never name packages.
2. **Local-only gating.** `isInstallAllowed(hostHeader)` is true only for local hosts AND when `BAKLAVA_DISABLE_DRIVER_INSTALL` is unset. Used by both the route (403) and the home page (`canInstall` → hides the button).
3. **GET SSE** matches the repo's existing action-triggering stream routes (`images/pull-stream`). Wire format `event: <name>\ndata: <json>\n\n`; 15s heartbeat; `req.signal` abort teardown.
4. **No rebuild/restart**: after a successful install, `invalidatePresence(pkgs)` clears the resolve cache and the client `router.refresh()`es.
5. Run `npm test` + `npm run typecheck` after each task; commit per task. Branch: `feat/driver-install`.

## File Structure

- Create `src/lib/techs/install.ts` — `resolveInstallPackages`, `isInstallAllowed` (pure, server-only). Test `src/lib/techs/install.test.ts`.
- Modify `src/techs/presence.ts` — add `invalidatePresence`. Test extends `src/techs/presence.test.ts`.
- Create `src/app/api/techs/[id]/install/route.ts` — GET SSE endpoint. Test `src/app/api/techs/[id]/install/route.test.ts`.
- Create `src/components/install-driver-dialog.tsx` — SSE-driven progress dialog (client).
- Modify `src/app/page.tsx` — pass `optionalDeps` + `canInstall`.
- Modify `src/components/tech-grid.tsx` — needs-line + install button / copy hint + dialog wiring.

---

## Task 1: Install helpers (security rules)

**Files:**
- Create: `src/lib/techs/install.ts`
- Test: `src/lib/techs/install.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/techs/install.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { resolveInstallPackages, isInstallAllowed } from "./install";

describe("resolveInstallPackages", () => {
  it("returns the tech's declared optionalDeps", () => {
    expect(resolveInstallPackages("postgres")).toEqual(["pg"]);
    expect(resolveInstallPackages("mongo")).toEqual(["mongodb", "bson"]);
  });
  it("throws for an unknown tech (never trusts client input)", () => {
    expect(() => resolveInstallPackages("rm -rf")).toThrow();
    expect(() => resolveInstallPackages("loadtest")).toThrow(); // tool, not in meta-registry
  });
});

describe("isInstallAllowed", () => {
  afterEach(() => { delete process.env.BAKLAVA_DISABLE_DRIVER_INSTALL; });
  it("allows local hosts", () => {
    expect(isInstallAllowed("localhost:3000")).toBe(true);
    expect(isInstallAllowed("127.0.0.1:3000")).toBe(true);
    expect(isInstallAllowed("[::1]:3000")).toBe(true);
    expect(isInstallAllowed("app.localhost:3000")).toBe(true);
  });
  it("denies non-local hosts", () => {
    expect(isInstallAllowed("baklava.example.com")).toBe(false);
    expect(isInstallAllowed("10.0.0.5:3000")).toBe(false);
    expect(isInstallAllowed(null)).toBe(false);
  });
  it("denies everything when disabled by env", () => {
    process.env.BAKLAVA_DISABLE_DRIVER_INSTALL = "1";
    expect(isInstallAllowed("localhost:3000")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/techs/install.test.ts`
Expected: FAIL — cannot find `./install`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/techs/install.ts
import "server-only";
import { techMetaById } from "@/techs/meta-registry";

/** Packages to install for a tech — derived from the registry, NEVER from client
 *  input. Throws for an unknown tech or one with no installable driver. */
export function resolveInstallPackages(techId: string): string[] {
  const meta = techMetaById.get(techId);
  if (!meta) throw new Error(`Unknown tech: ${techId}`);
  if (!meta.optionalDeps.length) {
    throw new Error(`Tech "${techId}" has no installable driver packages`);
  }
  return meta.optionalDeps;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Strip port / IPv6 brackets from a Host header → bare lowercase hostname. */
function hostnameOf(hostHeader: string | null): string {
  if (!hostHeader) return "";
  const h = hostHeader.trim();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]")).toLowerCase(); // [::1]:3000
  return h.split(":")[0].toLowerCase();
}

/** Install is allowed only for local requests, and only when not disabled by env. */
export function isInstallAllowed(hostHeader: string | null): boolean {
  if (process.env.BAKLAVA_DISABLE_DRIVER_INSTALL) return false;
  const h = hostnameOf(hostHeader);
  return LOCAL_HOSTS.has(h) || h.endsWith(".localhost");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/techs/install.test.ts && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/techs/install.ts src/lib/techs/install.test.ts
git commit -m "feat(techs): install helpers — resolveInstallPackages + isInstallAllowed"
```

---

## Task 2: Presence cache invalidation

**Files:**
- Modify: `src/techs/presence.ts`
- Test: `src/techs/presence.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `src/techs/presence.test.ts`:

```ts
import { isDriverInstalled, invalidatePresence } from "./presence";

describe("invalidatePresence", () => {
  it("clears specific packages so they are re-resolved", () => {
    // Seed the cache with a known-good package
    expect(isDriverInstalled("zod")).toBe(true);
    // Invalidating it must not throw and must allow a fresh resolve (still true)
    invalidatePresence(["zod"]);
    expect(isDriverInstalled("zod")).toBe(true);
  });
  it("clears the whole cache when called with no args", () => {
    isDriverInstalled("zod");
    invalidatePresence();
    expect(isDriverInstalled("zod")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/techs/presence.test.ts`
Expected: FAIL — `invalidatePresence` is not exported.

- [ ] **Step 3: Add the function** to `src/techs/presence.ts` (after `modulesInstalled`):

```ts
/** Drop cached resolution results so the next isDriverInstalled re-checks disk.
 *  Call after installing a driver at runtime. Omit `pkgs` to clear everything. */
export function invalidatePresence(pkgs?: string[]): void {
  if (!pkgs) {
    cache.clear();
    return;
  }
  for (const p of pkgs) cache.delete(p);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/techs/presence.test.ts && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/techs/presence.ts src/techs/presence.test.ts
git commit -m "feat(techs): invalidatePresence to clear the driver-resolve cache"
```

---

## Task 3: Install SSE route

**Files:**
- Create: `src/app/api/techs/[id]/install/route.ts`
- Test: `src/app/api/techs/[id]/install/route.test.ts`

- [ ] **Step 1: Write the failing test** (guards need no spawn; happy/error mock `node:child_process`):

```ts
// src/app/api/techs/[id]/install/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

import { GET } from "./route";

function makeReq(host: string) {
  return new Request(`http://${host}/api/techs/x/install`, { headers: { host } }) as never;
}
function ctx(id: string) { return { params: Promise.resolve({ id }) }; }

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  return out;
}

beforeEach(() => { spawnMock.mockReset(); delete process.env.BAKLAVA_DISABLE_DRIVER_INSTALL; });

describe("install route guards", () => {
  it("403 for a non-local host (no spawn)", async () => {
    const res = await GET(makeReq("evil.example.com"), ctx("postgres"));
    expect(res.status).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it("400 for an unknown tech (no spawn)", async () => {
    const res = await GET(makeReq("localhost:3000"), ctx("nope"));
    expect(res.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("install route happy path", () => {
  it("spawns npm install with the tech's deps and emits done", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    });
    spawnMock.mockReturnValue(child);
    const res = await GET(makeReq("localhost:3000"), ctx("postgres"));
    expect(spawnMock).toHaveBeenCalledWith("npm", ["install", "pg"], expect.objectContaining({ cwd: expect.any(String) }));
    // drive the fake process
    queueMicrotask(() => { child.stdout.emit("data", Buffer.from("added 1 package\n")); child.emit("close", 0); });
    const body = await readAll(res);
    expect(body).toContain("event: progress");
    expect(body).toContain("event: done");
    expect(body).toContain("pg");
  });
  it("emits error on non-zero npm exit", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
    });
    spawnMock.mockReturnValue(child);
    const res = await GET(makeReq("localhost:3000"), ctx("postgres"));
    queueMicrotask(() => { child.stderr.emit("data", Buffer.from("npm ERR! boom\n")); child.emit("close", 1); });
    const body = await readAll(res);
    expect(body).toContain("event: error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/techs/[id]/install/route.test.ts"`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/techs/[id]/install/route.ts
import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { resolveInstallPackages, isInstallAllowed } from "@/lib/techs/install";
import { invalidatePresence } from "@/techs/presence";
import { formatError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function sseError(message: string, status: number) {
  return new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

// In-flight installs, survives dev HMR via globalThis (per the store pattern).
const inFlight: Set<string> = ((globalThis as Record<symbol, unknown>)[
  Symbol.for("baklava.driverInstalls")
] ??= new Set<string>()) as Set<string>;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  if (!isInstallAllowed(req.headers.get("host"))) {
    return sseError("Driver install is only allowed from localhost", 403);
  }

  let packages: string[];
  try {
    packages = resolveInstallPackages(id);
  } catch (err) {
    return sseError(formatError(err), 400);
  }

  if (inFlight.has(id)) {
    return sseError("An install for this tech is already in progress", 409);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };
      inFlight.add(id);
      const heartbeat = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), 15_000);
      const child = spawn("npm", ["install", ...packages], { cwd: process.cwd() });

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        inFlight.delete(id);
        fn();
        try { controller.close(); } catch { /* closed */ }
      };

      req.signal.addEventListener("abort", () => {
        child.kill();
        finish(() => {});
      });

      safeEnqueue(sse("start", { packages }));

      const onData = (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) safeEnqueue(sse("progress", { line }));
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);

      child.on("error", (err) => {
        finish(() => safeEnqueue(sse("error", { message: formatError(err) })));
      });
      child.on("close", (code) => {
        finish(() => {
          if (code === 0) {
            invalidatePresence(packages);
            safeEnqueue(sse("done", { installed: packages }));
          } else {
            safeEnqueue(sse("error", { message: `npm install exited with code ${code}` }));
          }
        });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/techs/[id]/install/route.test.ts" && npm run typecheck`
Expected: PASS; clean. (If the happy-path stream test is flaky on timing, ensure the test drives the child events via `queueMicrotask` AFTER calling `GET`, as written.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/techs/[id]/install/route.ts" "src/app/api/techs/[id]/install/route.test.ts"
git commit -m "feat(techs): GET-SSE driver install route (local-only, registry-derived packages)"
```

---

## Task 4: Install dialog component

**Files:**
- Create: `src/components/install-driver-dialog.tsx`

First confirm the shadcn Dialog exists: `ls src/components/ui/dialog.tsx`. If absent, run `npx shadcn@latest add dialog --yes`. Confirm `sonner`'s `toast` is importable (it's a dependency and the Toaster is mounted app-wide).

- [ ] **Step 1: Write the component**

```tsx
// src/components/install-driver-dialog.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Props {
  techId: string | null;
  techName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InstallDriverDialog({ techId, techName, open, onOpenChange }: Props) {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"running" | "error">("running");
  const [error, setError] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open || !techId) return;
    setLog([]);
    setStatus("running");
    setError("");

    const es = new EventSource(`/api/techs/${techId}/install`);
    sourceRef.current = es;

    es.addEventListener("start", (e) => {
      const { packages } = JSON.parse((e as MessageEvent).data) as { packages: string[] };
      setLog((l) => [...l, `$ npm install ${packages.join(" ")}`]);
    });
    es.addEventListener("progress", (e) => {
      const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
      setLog((l) => [...l, line]);
    });
    es.addEventListener("done", () => {
      es.close();
      toast.success(`${techName} driver installed`);
      router.refresh();
      onOpenChange(false);
    });
    es.addEventListener("error", (e) => {
      let message = "Install failed (connection lost)";
      const data = (e as MessageEvent).data;
      if (data) {
        try { message = (JSON.parse(data) as { message: string }).message ?? message; } catch { /* native error event */ }
      }
      setStatus("error");
      setError(message);
      es.close();
    });

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [open, techId, techName, router, onOpenChange]);

  // Belt-and-suspenders unmount cleanup (per SSE-client convention).
  useEffect(() => () => sourceRef.current?.close(), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Installing {techName} driver</DialogTitle>
          <DialogDescription>
            Running npm install for the {techName} driver packages.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap">
          {log.join("\n") || "Starting…"}
        </pre>
        {status === "error" && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: clean. (If `DialogDescription` isn't exported by the local `dialog.tsx`, drop that line.)

- [ ] **Step 3: Commit**

```bash
git add src/components/install-driver-dialog.tsx
git commit -m "feat(ui): SSE-driven install-driver dialog"
```

---

## Task 5: Home page + tech-grid wiring

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/tech-grid.tsx`

- [ ] **Step 1: Update `src/app/page.tsx`** to pass `optionalDeps` + `canInstall`:

```tsx
import { headers } from "next/headers";
import { TechGrid } from "@/components/tech-grid";
import { TECH_META_LIST } from "@/techs/meta-registry";
import { isDriverInstalled } from "@/techs/presence";
import { isInstallAllowed } from "@/lib/techs/install";

export default async function Home() {
  const installed: Record<string, boolean> = {};
  const optionalDeps: Record<string, string[]> = {};
  for (const m of TECH_META_LIST) {
    installed[m.id] = m.optionalDeps.every(isDriverInstalled);
    optionalDeps[m.id] = m.optionalDeps;
  }
  const canInstall = isInstallAllowed((await headers()).get("host"));

  return (
    <div className="mx-auto max-w-6xl px-6 pt-6 pb-12">
      <TechGrid installed={installed} optionalDeps={optionalDeps} canInstall={canInstall} />
    </div>
  );
}
```

- [ ] **Step 2: Update `src/components/tech-grid.tsx`**

2a. Extend imports + props signature:

```tsx
import { InstallDriverDialog } from "@/components/install-driver-dialog";
// ...
export function TechGrid({
  installed = {},
  optionalDeps = {},
  canInstall = false,
}: {
  installed?: Record<string, boolean>;
  optionalDeps?: Record<string, string[]>;
  canInstall?: boolean;
}) {
```

2b. Add dialog state next to `openTech`:

```tsx
  const [installTech, setInstallTech] = useState<TechMeta | null>(null);
```

2c. In the `driverMissing` branch of the tile JSX, replace the existing
`{driverMissing && (<p>Driver not installed</p>)}` block with the needs-line +
action:

```tsx
              {driverMissing && (
                <div className="flex flex-col items-center gap-1.5">
                  <p className="text-[10.5px] text-muted-foreground/80 leading-tight">
                    needs: {(optionalDeps[tech.id] ?? []).join(", ")}
                  </p>
                  {canInstall ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInstallTech(tech);
                      }}
                      className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/20 transition-colors"
                    >
                      Install driver
                    </button>
                  ) : (
                    <code className="text-[10px] text-muted-foreground/70 select-all">
                      npm i {(optionalDeps[tech.id] ?? []).join(" ")}
                    </code>
                  )}
                </div>
              )}
```

2d. Render the dialog before the closing `</div>` of the component (next to `<ConnectionSheet>`):

```tsx
      <InstallDriverDialog
        techId={installTech?.id ?? null}
        techName={installTech?.name ?? ""}
        open={installTech !== null}
        onOpenChange={(o) => { if (!o) setInstallTech(null); }}
      />
```

Note: the `driverMissing` tile is wrapped in a non-interactive `<div aria-disabled>` (not a `<button>`), so the Install button is a normal nested button; the `e.stopPropagation()` is defensive.

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass; build succeeds (server component `page.tsx` may now be async — that is valid in the App Router). Confirm `presence`/`install` server-only modules are NOT pulled into the client `tech-grid` bundle (build would error on `node:module`/`server-only` otherwise).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/tech-grid.tsx
git commit -m "feat(ui): home-grid install button + needs hint wired to install dialog"
```

---

## Task 6: Manual verification (dogfood)

No code; verify the real flow once.

- [ ] **Step 1:** In a scratch state, simulate a missing driver: `npm uninstall mongodb bson` (removes them but keeps them in `optionalDependencies` since they're declared there — verify `package.json` still lists them; if `npm uninstall` strips the optionalDependencies entry, instead temporarily rename `node_modules/mongodb`).
- [ ] **Step 2:** `npm run dev`, open `http://localhost:3000`. The MongoDB tile shows dimmed with `needs: mongodb, bson` and an **Install driver** button.
- [ ] **Step 3:** Click it. The dialog streams `npm install` progress, toasts success, and the tile re-enables without restarting the dev server. Open a Mongo connection to confirm the driver loads.
- [ ] **Step 4:** Restore: `npm install`. Confirm `git status` is clean (no stray `package.json`/lockfile changes beyond what you intend).
- [ ] **Step 5 (negative):** set `BAKLAVA_DISABLE_DRIVER_INSTALL=1 npm run dev` → the button is replaced by the `npm i …` copy hint, and hitting the route directly returns a 403 `error` event.

---

## Self-Review (completed during authoring)

- **Spec coverage:** security rules (Task 1) ✓; presence invalidation (Task 2) ✓; SSE route with gating/derivation/concurrency/spawn/done/error (Task 3) ✓; dialog with EventSource + cleanup + toast + refresh (Task 4) ✓; page `canInstall`/`optionalDeps` + grid button/copy-hint (Task 5) ✓; testing (pure fns + route guards + mocked happy/error) ✓; manual no-restart verification (Task 6) ✓; non-goals (no uninstall, npm-only, local-only) respected ✓.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `resolveInstallPackages(techId: string): string[]`, `isInstallAllowed(hostHeader: string | null): boolean`, `invalidatePresence(pkgs?: string[])`, dialog props `{ techId: string|null, techName: string, open, onOpenChange }`, grid props `{ installed, optionalDeps, canInstall }` — consistent across route, page, grid, dialog. SSE events `start`/`progress`/`done`/`error` consistent between route and dialog.
- **Flagged for implementation:** confirm `src/components/ui/dialog.tsx` exists (else `npx shadcn add dialog`); the no-restart behavior under Turbopack dev is the one runtime check (Task 6 Step 3).
