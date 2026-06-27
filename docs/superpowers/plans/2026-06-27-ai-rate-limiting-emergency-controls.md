# AI Rate Limiting & Emergency Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the AI assistant's tool use with per-session rate limits, a destructive-action circuit breaker, a per-session call budget, and a persisted global kill switch — plus a user-facing Stop button — all enforced at the one server-side chokepoint.

**Architecture:** `src/lib/ai/gate.ts` (`wrapExecute`) is the single point every tool call passes through (it already has `sessionId`, `connectionId`, `category`, `emit`, `appendAudit`). A new pure `src/lib/ai/limits.ts` holds the in-memory token/breaker/budget logic (injected clock for tests). A new `src/lib/ai/kill-switch.ts` persists a global flag (same `~/.baklava` store pattern as `policy-store.ts`). `gate.ts` checks the kill switch (blocks non-read tools), then enforces limits before executing. The per-run Stop is the existing abort path (`req.signal` → `streamText abortSignal`); we add a UI button that aborts the in-flight fetch.

**Tech Stack:** TypeScript, the existing `~/.baklava` JSON store pattern, vitest, React (assistant UI).

## Global Constraints

- Runtime: Node only (`export const runtime = "nodejs"` on routes). Server-only modules use `import "server-only"`.
- Data dir: `process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava")` via a `dataDir()` function. Kill-switch file: `ai-controls.json`. Modes: dir `0o700`, file `0o600`, atomic tmp+rename (match `policy-store.ts`).
- The chokepoint is `gate.ts wrapExecute` — do NOT add enforcement anywhere else. `GateContext` already carries `policy`, `connectionId`, `sessionId`, `emit`, `awaitApproval`, optional `now`.
- Reads stay smooth: `category === "read"` is never blocked by the kill switch or the destructive breaker, and limits are generous so a human-paced session never trips them; only runaway/burst patterns do.
- Default limits (exact values): session budget 300 tool calls; rate 40 calls / 10s per session+connection; destructive breaker 8 / 60s per session.
- Audit every block: `appendAudit(sessionId, { ...base, decision: "blocked", summary: <reason>, at })` and `emit("blocked", { tool, reason })`.
- Per-process in-memory limits are acceptable (single-instance self-hosted); the kill switch is persisted so it survives restart.
- Existing tests must stay green; `gate.test.ts`, `permissions.test.ts`, `pending.test.ts`, `audit.test.ts` already exist.

---

### Task 1: Limits module (rate + breaker + budget)

**Files:**
- Create: `src/lib/ai/limits.ts`
- Test: `src/lib/ai/limits.test.ts`

**Interfaces:**
- Consumes: nothing (pure, in-memory).
- Produces:
  - `type LimitCategory = "read" | "write" | "destructive"`
  - `interface LimitConfig { sessionBudget; rateWindowMs; rateMax; destructiveWindowMs; destructiveMax }`
  - `DEFAULT_LIMITS: LimitConfig`
  - `checkRateLimit(args: { sessionId; connectionId; category: LimitCategory; now?: number; config?: LimitConfig }): { allowed: boolean; reason?: string }` (records on allow)
  - `_resetLimitsForTests(): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/limits.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, DEFAULT_LIMITS, _resetLimitsForTests, type LimitConfig } from "./limits";

beforeEach(() => _resetLimitsForTests());

const cfg: LimitConfig = {
  sessionBudget: 5,
  rateWindowMs: 1000,
  rateMax: 3,
  destructiveWindowMs: 1000,
  destructiveMax: 2,
};

describe("checkRateLimit", () => {
  it("allows reads up to the rate cap then blocks within the window", () => {
    const base = { sessionId: "s", connectionId: "c", category: "read" as const, config: cfg };
    expect(checkRateLimit({ ...base, now: 0 }).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: 10 }).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: 20 }).allowed).toBe(true);
    const blocked = checkRateLimit({ ...base, now: 30 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/rate/i);
    // window slides: after rateWindowMs the oldest falls out
    expect(checkRateLimit({ ...base, now: 1100 }).allowed).toBe(true);
  });

  it("trips the destructive breaker independent of the overall rate", () => {
    const base = { sessionId: "s2", connectionId: "c", category: "destructive" as const, config: cfg };
    expect(checkRateLimit({ ...base, now: 0 }).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: 10 }).allowed).toBe(true);
    const tripped = checkRateLimit({ ...base, now: 20 });
    expect(tripped.allowed).toBe(false);
    expect(tripped.reason).toMatch(/destructive/i);
  });

  it("enforces the per-session budget across connections", () => {
    let n = 0;
    const fire = (conn: string) =>
      checkRateLimit({ sessionId: "s3", connectionId: conn, category: "read", now: (n += 1) * 1000, config: cfg });
    for (let i = 0; i < 5; i++) expect(fire(`c${i}`).allowed).toBe(true); // 5 = budget
    const over = fire("c6");
    expect(over.allowed).toBe(false);
    expect(over.reason).toMatch(/budget/i);
  });

  it("scopes the rate window per session+connection", () => {
    const a = { sessionId: "sA", connectionId: "c", category: "read" as const, config: cfg };
    const b = { sessionId: "sB", connectionId: "c", category: "read" as const, config: cfg };
    for (let i = 0; i < 3; i++) expect(checkRateLimit({ ...a, now: i }).allowed).toBe(true);
    expect(checkRateLimit({ ...a, now: 4 }).allowed).toBe(false); // sA capped
    expect(checkRateLimit({ ...b, now: 4 }).allowed).toBe(true); // sB independent
  });

  it("has sane defaults", () => {
    expect(DEFAULT_LIMITS.sessionBudget).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.destructiveMax).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ai/limits.test.ts`
Expected: FAIL — cannot find module `./limits`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ai/limits.ts
import "server-only";

export type LimitCategory = "read" | "write" | "destructive";

export interface LimitConfig {
  sessionBudget: number;
  rateWindowMs: number;
  rateMax: number;
  destructiveWindowMs: number;
  destructiveMax: number;
}

export const DEFAULT_LIMITS: LimitConfig = {
  sessionBudget: 300,
  rateWindowMs: 10_000,
  rateMax: 40,
  destructiveWindowMs: 60_000,
  destructiveMax: 8,
};

interface LimitState {
  totalBySession: Map<string, number>;
  callsByKey: Map<string, number[]>; // `${sessionId}:${connectionId}` → timestamps
  destructiveBySession: Map<string, number[]>;
}

const globalKey = Symbol.for("baklava.aiLimits");
function state(): LimitState {
  const g = globalThis as unknown as Record<symbol, LimitState>;
  if (!g[globalKey]) {
    g[globalKey] = {
      totalBySession: new Map(),
      callsByKey: new Map(),
      destructiveBySession: new Map(),
    };
  }
  return g[globalKey];
}

export interface CheckArgs {
  sessionId: string;
  connectionId: string;
  category: LimitCategory;
  now?: number;
  config?: LimitConfig;
}

export function checkRateLimit(args: CheckArgs): { allowed: boolean; reason?: string } {
  const cfg = args.config ?? DEFAULT_LIMITS;
  const now = args.now ?? Date.now();
  const s = state();

  const total = s.totalBySession.get(args.sessionId) ?? 0;
  if (total >= cfg.sessionBudget) {
    return { allowed: false, reason: `session tool-call budget reached (${cfg.sessionBudget})` };
  }

  const rkey = `${args.sessionId}:${args.connectionId}`;
  const calls = (s.callsByKey.get(rkey) ?? []).filter((t) => now - t < cfg.rateWindowMs);
  if (calls.length >= cfg.rateMax) {
    return { allowed: false, reason: "rate limit: too many actions in a short window" };
  }

  if (args.category === "destructive") {
    const ds = (s.destructiveBySession.get(args.sessionId) ?? []).filter(
      (t) => now - t < cfg.destructiveWindowMs,
    );
    if (ds.length >= cfg.destructiveMax) {
      return { allowed: false, reason: "too many destructive actions in a row — paused, try again shortly" };
    }
  }

  // record (consume)
  s.totalBySession.set(args.sessionId, total + 1);
  calls.push(now);
  s.callsByKey.set(rkey, calls);
  if (args.category === "destructive") {
    const ds = (s.destructiveBySession.get(args.sessionId) ?? []).filter(
      (t) => now - t < cfg.destructiveWindowMs,
    );
    ds.push(now);
    s.destructiveBySession.set(args.sessionId, ds);
  }
  return { allowed: true };
}

export function _resetLimitsForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[globalKey];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ai/limits.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/limits.ts src/lib/ai/limits.test.ts
git commit -m "feat(ai): per-session rate limit, destructive breaker, and call budget"
```

---

### Task 2: Kill switch (persisted global flag)

**Files:**
- Create: `src/lib/ai/kill-switch.ts`
- Test: `src/lib/ai/kill-switch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isKillSwitchOn(): boolean`, `setKillSwitch(on: boolean): void`, `_resetControlsForTests(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/kill-switch.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isKillSwitchOn, setKillSwitch, _resetControlsForTests } from "./kill-switch";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-ks-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  _resetControlsForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
});

describe("kill switch", () => {
  it("defaults off", () => {
    expect(isKillSwitchOn()).toBe(false);
  });

  it("persists on, survives a cache reset (reload from disk), 0600", () => {
    setKillSwitch(true);
    expect(isKillSwitchOn()).toBe(true);
    const file = path.join(dir, "ai-controls.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    _resetControlsForTests();
    expect(isKillSwitchOn()).toBe(true); // reloaded from disk
  });

  it("turns back off", () => {
    setKillSwitch(true);
    setKillSwitch(false);
    expect(isKillSwitchOn()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ai/kill-switch.test.ts`
Expected: FAIL — cannot find module `./kill-switch`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ai/kill-switch.ts
import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function dataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function file(): string {
  return path.join(dataDir(), "ai-controls.json");
}

const globalKey = Symbol.for("baklava.aiControls");
interface Controls {
  killSwitch: boolean;
}

function load(): Controls {
  const g = globalThis as unknown as Record<symbol, Controls>;
  if (g[globalKey]) return g[globalKey];
  let c: Controls = { killSwitch: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<Controls>;
    c = { killSwitch: parsed.killSwitch === true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[baklava] could not read ${file()}:`, err);
    }
  }
  return (g[globalKey] = c);
}

function persist(c: Controls): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error(`[baklava] could not persist ${file()}:`, err);
  }
}

export function isKillSwitchOn(): boolean {
  return load().killSwitch;
}

export function setKillSwitch(on: boolean): void {
  const c = load();
  c.killSwitch = on;
  persist(c);
  (globalThis as unknown as Record<symbol, Controls>)[globalKey] = c;
}

export function _resetControlsForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[globalKey];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ai/kill-switch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/kill-switch.ts src/lib/ai/kill-switch.test.ts
git commit -m "feat(ai): persisted global kill switch (ai-controls.json)"
```

---

### Task 3: Enforce kill switch + limits in the gate

**Files:**
- Modify: `src/lib/ai/gate.ts`
- Test: `src/lib/ai/gate.test.ts` (add cases; keep existing)

**Interfaces:**
- Consumes: `checkRateLimit`, `DEFAULT_LIMITS` (Task 1); `isKillSwitchOn` (Task 2); existing `isAllowed`, `needsApproval`, `appendAudit`.
- Produces: no signature change to `wrapExecute`/`GateContext`.

- [ ] **Step 1: Write the failing test (add to gate.test.ts)**

Add these cases. They need a minimal `GateContext` and a fake tool — mirror the existing gate.test.ts setup (reuse its helpers if present; otherwise this self-contained block):

```ts
// appended to src/lib/ai/gate.test.ts
import { setKillSwitch, _resetControlsForTests } from "./kill-switch";
import { _resetLimitsForTests } from "./limits";

describe("gate kill switch + limits", () => {
  beforeEach(() => {
    _resetControlsForTests();
    _resetLimitsForTests();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.aiControls")];
    process.env.BAKLAVA_DATA_DIR = require("node:fs").mkdtempSync(
      require("node:path").join(require("node:os").tmpdir(), "bk-gate-"),
    );
  });

  function makeCtx(category: "read" | "write" | "destructive") {
    const emitted: Array<{ event: string; data: unknown }> = [];
    const tool = {
      name: `t_${category}`,
      category,
      description: "",
      inputSchema: {},
      execute: async () => ({ ok: true }),
    } as unknown as import("./tools/types").AiTool;
    const ctx = {
      policy: { mode: "autonomous", read: true, write: true, destructive: true, confirmDestructive: false },
      connectionId: "c1",
      sessionId: "sess1",
      emit: (event: string, data: unknown) => emitted.push({ event, data }),
      awaitApproval: async () => true,
    };
    return { run: wrapExecute(tool, ctx as never), emitted };
  }

  it("blocks non-read tools when the kill switch is on; allows reads", async () => {
    setKillSwitch(true);
    const w = makeCtx("write");
    const r = (await w.run({}, "id1")) as { error?: string };
    expect(r.error).toMatch(/paused|kill/i);
    const read = makeCtx("read");
    const ok = (await read.run({}, "id2")) as { ok?: boolean; error?: string };
    expect(ok.error).toBeUndefined();
  });

  it("blocks once the destructive breaker trips", async () => {
    const d = makeCtx("destructive");
    let blocked = false;
    for (let i = 0; i < 20; i++) {
      const res = (await d.run({}, `id${i}`)) as { error?: string };
      if (res.error && /destructive|rate|budget/i.test(res.error)) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ai/gate.test.ts`
Expected: FAIL — kill switch / breaker not enforced yet (write executes, breaker never trips).

- [ ] **Step 3: Edit `gate.ts`**

Add imports at the top:

```ts
import { isKillSwitchOn } from "./kill-switch";
import { checkRateLimit } from "./limits";
```

Replace the body of `wrapExecute`'s returned function so the checks sit at the right points (kill switch first; limits after approval, before execute). Full replacement of the returned async function:

```ts
  return async (args: Record<string, unknown>, toolCallId = "unknown"): Promise<unknown> => {
    const base = {
      tool: tool.name,
      category: tool.category,
      connectionId: ctx.connectionId,
      args,
    };

    // Global kill switch: pause everything except reads.
    if (tool.category !== "read" && isKillSwitchOn()) {
      appendAudit(ctx.sessionId, { ...base, decision: "blocked", summary: "kill-switch", at: now() });
      ctx.emit("blocked", { tool: tool.name, reason: "kill-switch" });
      return { error: `AI actions are paused (kill switch is on). Re-enable it in Settings to continue.` };
    }

    if (!isAllowed(tool.category, ctx.policy)) {
      appendAudit(ctx.sessionId, { ...base, decision: "blocked", at: now() });
      return { error: `Action "${tool.name}" is not permitted by this connection's policy.` };
    }

    if (needsApproval(tool.category, ctx.policy)) {
      const approved = await ctx.awaitApproval(toolCallId, tool, args);
      if (!approved) {
        appendAudit(ctx.sessionId, { ...base, decision: "rejected", at: now() });
        return { declined: true, message: `User declined "${tool.name}".` };
      }
    }

    // Rate limit / circuit breaker / budget — counted only for actions we will
    // actually run (after approval), at the one chokepoint.
    const limit = checkRateLimit({
      sessionId: ctx.sessionId,
      connectionId: ctx.connectionId,
      category: tool.category,
      now: now(),
    });
    if (!limit.allowed) {
      appendAudit(ctx.sessionId, { ...base, decision: "blocked", summary: limit.reason, at: now() });
      ctx.emit("blocked", { tool: tool.name, reason: limit.reason });
      return { error: `Action blocked: ${limit.reason}.` };
    }

    try {
      const result = await tool.execute(args);
      ctx.emit("tool-result", { toolCallId, tool: tool.name, ok: true });
      appendAudit(ctx.sessionId, { ...base, decision: "executed", at: now() });
      return result;
    } catch (err) {
      const message = formatError(err);
      ctx.emit("tool-result", { toolCallId, tool: tool.name, ok: false, error: message });
      appendAudit(ctx.sessionId, { ...base, decision: "error", summary: message, at: now() });
      return { error: message };
    }
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/gate.test.ts`
Expected: PASS (existing cases + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/gate.ts src/lib/ai/gate.test.ts
git commit -m "feat(ai): enforce kill switch + rate/breaker/budget at the tool gate"
```

---

### Task 4: Kill-switch API route

**Files:**
- Create: `src/app/api/ai/kill-switch/route.ts`
- Test: `src/app/api/ai/kill-switch/kill-switch-route.test.ts`

**Interfaces:**
- Consumes: `isKillSwitchOn`, `setKillSwitch` (Task 2).
- Produces: `GET → { on: boolean }`, `POST { on: boolean } → { on: boolean }` (400 if `on` isn't a boolean). Gated by proxy.ts (requires a session) — do NOT add to PUBLIC_APIS.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/ai/kill-switch/kill-switch-route.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _resetControlsForTests } from "@/lib/ai/kill-switch";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-ksr-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  _resetControlsForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
});

describe("kill-switch API", () => {
  it("GET reports off by default; POST flips it", async () => {
    const { GET, POST } = await import("./route");
    const g0 = await (await GET()).json();
    expect(g0).toEqual({ on: false });

    const p = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ on: true }) }));
    expect(await p.json()).toEqual({ on: true });

    const g1 = await (await GET()).json();
    expect(g1).toEqual({ on: true });
  });

  it("POST rejects a non-boolean", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ on: "yes" }) }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/ai/kill-switch/kill-switch-route.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/ai/kill-switch/route.ts
import { NextResponse } from "next/server";
import { isKillSwitchOn, setKillSwitch } from "@/lib/ai/kill-switch";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ on: isKillSwitchOn() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "`on` must be a boolean" }, { status: 400 });
  }
  setKillSwitch(body.on);
  return NextResponse.json({ on: body.on });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/ai/kill-switch/kill-switch-route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/kill-switch/
git commit -m "feat(ai): kill-switch API (GET status, POST toggle)"
```

---

### Task 5: UI — Stop button + kill-switch toggle

**Files:**
- Modify: `src/app/assistant/assistant-client.tsx` (add a Stop button that aborts the in-flight chat fetch; add a kill-switch toggle in the assistant header)

**Interfaces:**
- Consumes: `GET/POST /api/ai/kill-switch` (Task 4); the existing chat fetch (`/api/ai/chat`).

First READ `src/app/assistant/assistant-client.tsx` to learn how it sends the chat request and tracks the streaming/loading state. It uses a `fetch` to `/api/ai/chat` and reads an SSE stream (same pattern as the load-test run client). It very likely does NOT keep an `AbortController` yet.

- [ ] **Step 1: Add an AbortController to the chat send + a Stop button**

In `assistant-client.tsx`:
1. Add a ref: `const abortRef = useRef<AbortController | null>(null);`
2. Where it calls `fetch("/api/ai/chat", { method: "POST", ... })`, create a controller and pass its signal:
   ```ts
   const ac = new AbortController();
   abortRef.current = ac;
   // ...fetch(..., { method: "POST", signal: ac.signal, ... })
   ```
3. Clear it when the stream finishes (in the `finally` of the send handler): `abortRef.current = null;`
4. Add an unmount abort: `useEffect(() => () => abortRef.current?.abort(), []);`
5. While a turn is streaming (the component already has a "loading"/"streaming" boolean — reuse it), render a **Stop** button that calls `abortRef.current?.abort()`. Place it where the Send button is (swap Send → Stop while streaming), matching the existing button styling.

Aborting the fetch closes the SSE; the server's `req.signal` already cancels the agent run (`abortSignal` is wired through `runAgent`). No server change needed.

- [ ] **Step 2: Add a kill-switch toggle in the assistant header**

Add a small control in the assistant header area:
1. On mount, `fetch("/api/ai/kill-switch")` → set local `killed` state from `{ on }`.
2. Render a toggle/button labeled "Pause AI" (or a red "AI paused — resume" when on). On click, `POST /api/ai/kill-switch` with `{ on: !killed }`, update state, and `toast` the result.
3. Use existing UI primitives (`Button` from `@/components/ui/button`, `toast` from `sonner`) consistent with the rest of the app. Keep it visually subdued when off, clearly red/amber when on.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — no errors.
Run: `npm run lint` — no errors.
Run: `npm run build` — succeeds (the assistant client compiles).

- [ ] **Step 4: Commit**

```bash
git add src/app/assistant/assistant-client.tsx
git commit -m "feat(assistant): Stop button for in-flight runs + AI kill-switch toggle"
```

---

### Task 6: Docs + full gate

**Files:**
- Modify: `README.md`, `AGENTS.md` (if it documents the AI assistant)

- [ ] **Step 1: Document the controls**

In the README (AI assistant section, if present, else a short new note): the assistant is bounded by per-session rate limits, a destructive-action circuit breaker, and a per-session call budget (generous — only runaway/burst patterns trip them); a global kill switch (Settings/assistant) pauses all non-read AI actions and persists across restarts; a Stop button aborts an in-flight run. Reads are never blocked by the kill switch or breaker.

- [ ] **Step 2: AGENTS.md**

If `AGENTS.md` documents the AI gate/assistant, add a one-line note that `gate.ts` enforces, in addition to policy + approval, a kill switch (`ai-controls.json`) and in-memory rate/breaker/budget limits. Otherwise skip.

- [ ] **Step 3: Full gate**

Run: `npm run typecheck` → no errors.
Run: `npm run lint` → no errors.
Run: `npm run test` → all green (new limits/kill-switch/gate/route tests + existing AI tests).
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document AI rate limits, circuit breaker, kill switch, and Stop"
```

---

## Self-Review

**Spec coverage** (spec §5):
- Per-session tool limits → `sessionBudget` (Task 1). ✅
- Per-connection limits → rate keyed by `sessionId:connectionId` (Task 1). ✅
- Consecutive destructive limits → destructive breaker (Task 1, enforced Task 3). ✅
- Global kill switch → persisted flag + gate enforcement + API + UI (Tasks 2-5). ✅
- Circuit breakers / cooldown → breaker with sliding window = automatic cooldown (Task 1). ✅
- Budget/token limits → per-session call budget (Task 1); model-token budget is bounded by the existing `stepCap` (noted follow-up). ✅ (documented scope)
- Emergency stop during execution → Stop button aborts the in-flight fetch → existing `abortSignal` cancels the run (Task 5). ✅
- Automatic detection of suspicious behavior → consecutive-destructive breaker is the lightweight anomaly signal (Task 1/3). ✅ (counters, not ML — per spec)

**Placeholder scan:** no TBD/TODO; complete code in every code step except Task 5 (UI), which gives exact ref/handler/wiring instructions against the existing client because the surrounding component is read at implementation time. ✅

**Type consistency:** `checkRateLimit` args/return, `LimitConfig` fields, `isKillSwitchOn`/`setKillSwitch`, `_resetLimitsForTests`/`_resetControlsForTests` names are consistent across Tasks 1-4. The gate edit consumes exactly those. ✅

## Out of scope (follow-ups)
- Model-token (not tool-call) budget enforcement (the agent's `stepCap` already bounds loop length).
- Distributed/multi-instance rate limits (per-process is fine for single-instance self-hosted).
- Richer anomaly heuristics (acting on an unnamed connection, escalating blast radius) beyond the consecutive-destructive breaker.
