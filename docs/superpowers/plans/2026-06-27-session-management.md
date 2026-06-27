# Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long-lived stateless session token with server-side, revocable session records (real logout, device list, log-out-everywhere, sliding idle expiry).

**Architecture:** A new `src/lib/auth/sessions.ts` store persists session records to `~/.baklava/sessions.json` (globalThis-cached, atomic 0600 write, same pattern as the other stores). `src/lib/auth/session.ts` becomes a thin cookie/token layer: the cookie carries `<sessionId>.<hmac(sessionId)>` (HMAC with the existing per-install auth secret as a cheap pre-filter), and `verifySessionToken` looks the id up in the store, enforces expiry, and slides `lastSeenAt`. New API routes + a Settings card expose the device list and revocation. `verifySessionToken(token): boolean` keeps its signature so `proxy.ts` and `layout.tsx` are untouched.

**Tech Stack:** TypeScript, Node `node:crypto` (HMAC, randomBytes), the existing `~/.baklava` JSON store pattern, vitest, React (Settings UI).

## Global Constraints

- Runtime: Node only (`export const runtime = "nodejs"` on routes).
- Data dir: `process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava")`, read per-call via a `getDataDir()` function (matches the connections/loadtest stores; needed for test isolation). File: `sessions.json`. Modes: dir `0o700`, file `0o600`, atomic tmp+rename.
- `sessions.json` is NOT encrypted — it holds opaque random session ids + metadata, not credentials. (Encryption-at-rest is for `connections.json`/`loadtests.json` only.)
- Cookie: keep `SESSION_COOKIE = "baklava_session"`, `httpOnly`, `sameSite: "lax"`, `secure` only over HTTPS (`isHttps`), `path: "/"`. Keep `sessionCookieOptions` and `isHttps` unchanged.
- HMAC signing key: the existing `getAuthSecret()` from `src/lib/auth/store.ts`. Do not introduce a new secret.
- Expiry: idle timeout 7 days (slides on use), absolute cap 30 days from creation.
- `verifySessionToken(token: string | undefined | null): boolean` MUST keep this exact signature (consumed by `src/proxy.ts` and `src/app/layout.tsx`).
- Lint: `@typescript-eslint/no-unused-vars` is enforced — remove imports you stop using.
- Migration: existing stateless cookies become invalid on upgrade (their "id" isn't in the store) → one forced re-login. This is intended; document it.

---

### Task 1: Session store (`sessions.ts`)

**Files:**
- Create: `src/lib/auth/sessions.ts`
- Test: `src/lib/auth/sessions.test.ts`

**Interfaces:**
- Consumes: nothing (fs + node:crypto only).
- Produces:
  - `interface SessionRecord { id: string; createdAt: number; lastSeenAt: number; expiresAt: number; userAgent: string }`
  - `createSession(userAgent: string, now?: number): SessionRecord`
  - `verifySession(id: string, now?: number): boolean` (deletes + returns false when expired; slides `lastSeenAt`, persists at most every 5 min)
  - `revokeSession(id: string): void`
  - `revokeAllExcept(keepId: string | null): void`
  - `listSessions(now?: number): SessionRecord[]` (active only, newest-first)
  - `_resetSessionCacheForTests(): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/sessions.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSession, verifySession, revokeSession, revokeAllExcept, listSessions,
  _resetSessionCacheForTests,
} from "./sessions";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-sess-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  _resetSessionCacheForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
});

describe("sessions store", () => {
  it("creates and verifies a session, persisted 0600", () => {
    const rec = createSession("Mozilla/Test");
    expect(rec.id).toBeTruthy();
    expect(verifySession(rec.id)).toBe(true);
    const file = path.join(dir, "sessions.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("rejects an unknown id", () => {
    expect(verifySession("nope")).toBe(false);
  });

  it("expires after the idle window and deletes the record", () => {
    const now = 1_000_000_000_000;
    const rec = createSession("ua", now);
    // 7 days + 1ms of idle
    const later = now + 7 * 24 * 60 * 60 * 1000 + 1;
    expect(verifySession(rec.id, later)).toBe(false);
    expect(verifySession(rec.id, later)).toBe(false); // gone
  });

  it("enforces the 30-day absolute cap even with activity", () => {
    const now = 1_000_000_000_000;
    const rec = createSession("ua", now);
    // keep active every 6 days for 31 days
    let t = now;
    for (let i = 0; i < 5; i++) {
      t += 6 * 24 * 60 * 60 * 1000;
      verifySession(rec.id, t); // slides lastSeen, but absolute cap holds
    }
    const past30 = now + 30 * 24 * 60 * 60 * 1000 + 1;
    expect(verifySession(rec.id, past30)).toBe(false);
  });

  it("revokes one and all-except", () => {
    const a = createSession("a");
    const b = createSession("b");
    const c = createSession("c");
    revokeSession(a.id);
    expect(verifySession(a.id)).toBe(false);
    expect(verifySession(b.id)).toBe(true);
    revokeAllExcept(c.id);
    expect(verifySession(b.id)).toBe(false);
    expect(verifySession(c.id)).toBe(true);
  });

  it("lists active sessions newest-first", () => {
    const now = 1_000_000_000_000;
    createSession("old", now);
    createSession("new", now + 1000);
    const list = listSessions(now + 2000);
    expect(list.map((r) => r.userAgent)).toEqual(["new", "old"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/sessions.test.ts`
Expected: FAIL — cannot find module `./sessions`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/auth/sessions.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface SessionRecord {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number; // absolute cap (createdAt + 30d)
  userAgent: string;
}

const IDLE_MS = 7 * 24 * 60 * 60 * 1000; // slide window
const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // hard cap
const PERSIST_THROTTLE_MS = 5 * 60 * 1000; // bound disk writes from sliding

function getDataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function getFile(): string {
  return path.join(getDataDir(), "sessions.json");
}

const cacheKey = Symbol.for("baklava.sessionStore");
interface Store {
  byId: Map<string, SessionRecord>;
  lastPersistById: Map<string, number>;
}

function load(): Store {
  const g = globalThis as unknown as Record<symbol, Store>;
  if (g[cacheKey]) return g[cacheKey];
  const byId = new Map<string, SessionRecord>();
  try {
    const arr = JSON.parse(fs.readFileSync(getFile(), "utf8")) as SessionRecord[];
    if (Array.isArray(arr)) for (const r of arr) if (r?.id) byId.set(r.id, r);
  } catch {
    /* ENOENT or malformed → start empty */
  }
  return (g[cacheKey] = { byId, lastPersistById: new Map() });
}

function persist(store: Store): void {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${getFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...store.byId.values()], null, 2), { mode: 0o600 });
    fs.renameSync(tmp, getFile());
  } catch (err) {
    console.error(`[baklava] could not persist ${getFile()}:`, err);
  }
}

function isActive(r: SessionRecord, now: number): boolean {
  return now <= r.expiresAt && now <= r.lastSeenAt + IDLE_MS;
}

export function createSession(userAgent: string, now: number = Date.now()): SessionRecord {
  const store = load();
  const rec: SessionRecord = {
    id: randomBytes(18).toString("base64url"),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ABSOLUTE_MS,
    userAgent: (userAgent || "unknown").slice(0, 256),
  };
  store.byId.set(rec.id, rec);
  store.lastPersistById.set(rec.id, now);
  persist(store);
  return rec;
}

export function verifySession(id: string, now: number = Date.now()): boolean {
  const store = load();
  const rec = store.byId.get(id);
  if (!rec) return false;
  if (!isActive(rec, now)) {
    store.byId.delete(id);
    store.lastPersistById.delete(id);
    persist(store);
    return false;
  }
  rec.lastSeenAt = now; // slide in memory
  const lastP = store.lastPersistById.get(id) ?? 0;
  if (now - lastP > PERSIST_THROTTLE_MS) {
    store.lastPersistById.set(id, now);
    persist(store);
  }
  return true;
}

export function revokeSession(id: string): void {
  const store = load();
  if (store.byId.delete(id)) {
    store.lastPersistById.delete(id);
    persist(store);
  }
}

export function revokeAllExcept(keepId: string | null): void {
  const store = load();
  let changed = false;
  for (const id of [...store.byId.keys()]) {
    if (id !== keepId) {
      store.byId.delete(id);
      store.lastPersistById.delete(id);
      changed = true;
    }
  }
  if (changed) persist(store);
}

export function listSessions(now: number = Date.now()): SessionRecord[] {
  return [...load().byId.values()]
    .filter((r) => isActive(r, now))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function _resetSessionCacheForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[cacheKey];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/sessions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/sessions.ts src/lib/auth/sessions.test.ts
git commit -m "feat(auth): server-side session store with sliding + absolute expiry"
```

---

### Task 2: Make `session.ts` a token layer over the store

**Files:**
- Modify: `src/lib/auth/session.ts` (replace the stateless token logic; keep `SESSION_COOKIE`, `SESSION_MAX_AGE_S`, `sessionCookieOptions`, `isHttps` unchanged)
- Modify: `src/lib/auth/auth.test.ts` (isolate data dir + reset caches; existing assertions stay valid)
- Test: `src/lib/auth/session-token.test.ts`

**Interfaces:**
- Consumes: `createSession`, `verifySession`, `revokeSession` (Task 1); `getAuthSecret` (existing).
- Produces:
  - `createSessionToken(userAgent?: string): string` (now creates a server record; returns `<id>.<hmac(id)>`)
  - `verifySessionToken(token: string | undefined | null): boolean` (sig check → store lookup → slide)
  - `revokeSessionToken(token: string | undefined | null): void`
  - `sessionIdFromToken(token: string | undefined | null): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/session-token.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSessionToken, verifySessionToken, revokeSessionToken, sessionIdFromToken,
} from "./session";
import { _resetSessionCacheForTests } from "./sessions";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-tok-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  // Force a known auth secret so HMAC is deterministic and no real ~/.baklava is touched.
  process.env.BAKLAVA_INITIAL_PASSWORD = "x";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.authState")];
  _resetSessionCacheForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
});

describe("session token layer", () => {
  it("round-trips a created token", () => {
    const token = createSessionToken("Mozilla/Test");
    expect(verifySessionToken(token)).toBe(true);
    expect(sessionIdFromToken(token)).toBeTruthy();
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken("ua");
    expect(verifySessionToken(token + "x")).toBe(false);
    expect(verifySessionToken("garbage")).toBe(false);
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
  });

  it("revokes a token so it no longer verifies", () => {
    const token = createSessionToken("ua");
    expect(verifySessionToken(token)).toBe(true);
    revokeSessionToken(token);
    expect(verifySessionToken(token)).toBe(false);
  });

  it("rejects a well-signed id that has no server record", () => {
    // A leftover stateless cookie: correct HMAC over a payload that isn't a real id.
    const token = createSessionToken("ua");
    const id = sessionIdFromToken(token)!;
    revokeSessionToken(token); // delete the record but keep using the (now stale) token
    expect(sessionIdFromToken(token)).toBe(id); // sig still valid
    expect(verifySessionToken(token)).toBe(false); // but no record → false
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/session-token.test.ts`
Expected: FAIL — `createSessionToken`/`sessionIdFromToken`/`revokeSessionToken` not exported as expected (signature mismatch / missing exports).

- [ ] **Step 3: Rewrite `src/lib/auth/session.ts`**

Replace the file contents with (keeps `sessionCookieOptions`/`isHttps` byte-for-byte; swaps the token core to the store):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAuthSecret } from "./store";
import { createSession, verifySession, revokeSession } from "./sessions";

// The cookie carries `<sessionId>.<hmac(sessionId)>`. The HMAC (per-install auth
// secret) is a cheap pre-filter to reject forged/garbage ids before a store
// lookup; the server-side record is the source of truth, so logout and the
// device list can actually revoke a session.

export const SESSION_COOKIE = "baklava_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // cookie max-age (idle slide is enforced server-side)

function sign(id: string): string {
  return createHmac("sha256", getAuthSecret()).update(id).digest("base64url");
}

export function sessionIdFromToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(id));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export function createSessionToken(userAgent = ""): string {
  const rec = createSession(userAgent);
  return `${rec.id}.${sign(rec.id)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  const id = sessionIdFromToken(token);
  if (!id) return false;
  return verifySession(id);
}

export function revokeSessionToken(token: string | undefined | null): void {
  const id = sessionIdFromToken(token);
  if (id) revokeSession(id);
}

/** Cookie options. `secure` is set only over HTTPS so the cookie still works on
 *  plain-HTTP homelab deployments. */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: SESSION_MAX_AGE_S,
  };
}

/** Best-effort detection of an HTTPS request behind a proxy or direct. */
export function isHttps(req: {
  headers: { get(name: string): string | null };
  url: string;
}): boolean {
  const fwd = req.headers.get("x-forwarded-proto");
  if (fwd) return fwd.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Update `src/lib/auth/auth.test.ts` for isolation**

The existing session round-trip test in `auth.test.ts` now writes a real `sessions.json`. Add isolation so it uses a temp dir and a deterministic secret. At the top of the file's session `describe` (or in a `beforeEach`/`afterEach` covering the session cases), add:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _resetSessionCacheForTests } from "./sessions";

let sessDir: string;
beforeEach(() => {
  sessDir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-auth-"));
  process.env.BAKLAVA_DATA_DIR = sessDir;
  process.env.BAKLAVA_INITIAL_PASSWORD = "x";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.authState")];
  _resetSessionCacheForTests();
});
afterEach(() => {
  fs.rmSync(sessDir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
});
```

If `auth.test.ts` already has hooks, merge these lines into them rather than adding a second pair. Keep the existing assertions: `createSessionToken()` (now valid with the default `""` userAgent) then `verifySessionToken(token) === true`; the tamper/empty/undefined cases stay `false`; the manually-built "expired" token case stays `false` (its crafted id has no record).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/auth/session-token.test.ts src/lib/auth/auth.test.ts`
Expected: PASS (new file + existing auth tests green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/session.ts src/lib/auth/session-token.test.ts src/lib/auth/auth.test.ts
git commit -m "feat(auth): cookie carries a revocable server session id (was stateless token)"
```

---

### Task 3: Wire auth routes to the session store

**Files:**
- Modify: `src/app/api/auth/login/route.ts`, `src/app/api/auth/setup/route.ts`, `src/app/api/auth/change-password/route.ts`, `src/app/api/auth/logout/route.ts`

**Interfaces:**
- Consumes: `createSessionToken(userAgent)`, `revokeSessionToken(token)` (Task 2); `revokeAllExcept` (Task 1).

- [ ] **Step 1: login — pass the user agent**

In `src/app/api/auth/login/route.ts`, change the cookie-set call (currently `createSessionToken()`):

```ts
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(req.headers.get("user-agent") ?? ""),
    sessionCookieOptions(isHttps(req)),
  );
```

- [ ] **Step 2: setup — pass the user agent**

In `src/app/api/auth/setup/route.ts`, make the same change to its `createSessionToken()` call:

```ts
    createSessionToken(req.headers.get("user-agent") ?? ""),
```

- [ ] **Step 3: change-password — revoke all then issue a fresh session**

In `src/app/api/auth/change-password/route.ts`, after `setPassword(newPassword);` and before re-issuing the cookie, revoke every existing session (a password change signs out all devices), then mint a new one:

```ts
  setPassword(newPassword);

  // A password change invalidates every existing session (all devices).
  revokeAllExcept(null);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(req.headers.get("user-agent") ?? ""),
    sessionCookieOptions(isHttps(req)),
  );
  return res;
```

Add the import: `import { revokeAllExcept } from "@/lib/auth/sessions";`

- [ ] **Step 4: logout — revoke the current session server-side**

Rewrite `src/app/api/auth/logout/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  isHttps,
  revokeSessionToken,
} from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  revokeSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(isHttps(req)),
    maxAge: 0,
  });
  return res;
}
```

- [ ] **Step 5: Verify the auth route tests still pass**

Run: `npx vitest run src/app/api/auth`
Expected: PASS. If a route test asserts on the cookie token shape, update it to accept the `<id>.<sig>` form (the value is still an opaque string). If no such test exists, no change needed.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/auth/login/route.ts src/app/api/auth/setup/route.ts src/app/api/auth/change-password/route.ts src/app/api/auth/logout/route.ts
git commit -m "feat(auth): record session on login/setup, revoke on logout, rotate on password change"
```

---

### Task 4: Session-management API routes

**Files:**
- Create: `src/app/api/auth/sessions/route.ts` (GET list)
- Create: `src/app/api/auth/sessions/[id]/route.ts` (DELETE one)
- Create: `src/app/api/auth/sessions/revoke-others/route.ts` (POST revoke all but current)
- Test: `src/app/api/auth/sessions/sessions-route.test.ts`

**Interfaces:**
- Consumes: `listSessions`, `revokeSession`, `revokeAllExcept` (Task 1); `sessionIdFromToken`, `SESSION_COOKIE` (Task 2).
- Produces (response shape for the UI in Task 5): `GET` → `{ sessions: Array<{ id: string; createdAt: number; lastSeenAt: number; userAgent: string; current: boolean }> }`.

These routes are gated by `proxy.ts` (any authenticated session). Do NOT add them to `PUBLIC_APIS`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/auth/sessions/sessions-route.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { _resetSessionCacheForTests } from "@/lib/auth/sessions";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-sr-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_INITIAL_PASSWORD = "x";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.authState")];
  _resetSessionCacheForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_DATA_DIR;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
});

function reqWithCookie(url: string, token: string, method = "GET") {
  return new Request(url, { method, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

describe("sessions API", () => {
  it("lists sessions and marks the current one", async () => {
    const { GET } = await import("./route");
    const mine = createSessionToken("device-A");
    createSessionToken("device-B");
    const res = await GET(reqWithCookie("http://x/api/auth/sessions", mine) as never);
    const body = (await res.json()) as { sessions: Array<{ userAgent: string; current: boolean }> };
    expect(body.sessions.length).toBe(2);
    const current = body.sessions.filter((s) => s.current);
    expect(current).toHaveLength(1);
    expect(current[0].userAgent).toBe("device-A");
  });

  it("revoke-others keeps only the caller's session", async () => {
    const { POST } = await import("./revoke-others/route");
    const mine = createSessionToken("keep");
    createSessionToken("drop-1");
    createSessionToken("drop-2");
    const res = await POST(reqWithCookie("http://x/api/auth/sessions/revoke-others", mine, "POST") as never);
    expect(res.status).toBe(200);
    const { GET } = await import("./route");
    const list = await GET(reqWithCookie("http://x/api/auth/sessions", mine) as never);
    const body = (await list.json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/auth/sessions/sessions-route.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement the routes**

```ts
// src/app/api/auth/sessions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listSessions } from "@/lib/auth/sessions";
import { SESSION_COOKIE, sessionIdFromToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const currentId = sessionIdFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  const sessions = listSessions().map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    userAgent: s.userAgent,
    current: s.id === currentId,
  }));
  return NextResponse.json({ sessions });
}
```

```ts
// src/app/api/auth/sessions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revokeSession } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  revokeSession(id);
  return NextResponse.json({ ok: true });
}
```

```ts
// src/app/api/auth/sessions/revoke-others/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revokeAllExcept } from "@/lib/auth/sessions";
import { SESSION_COOKIE, sessionIdFromToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const currentId = sessionIdFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  revokeAllExcept(currentId);
  return NextResponse.json({ ok: true });
}
```

Note: the test imports `./route` and calls `GET`/`POST` with a plain `Request`; `NextRequest` accepts it at runtime. The `as never` cast in the test keeps TypeScript quiet.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/auth/sessions/sessions-route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/sessions/
git commit -m "feat(auth): API to list and revoke sessions (device list, sign-out-others)"
```

---

### Task 5: Settings — Active sessions card

**Files:**
- Create: `src/app/settings/active-sessions.tsx`
- Modify: `src/app/settings/settings-client.tsx` (render `<ActiveSessions />` in the security area, next to `<SecuritySettings />`)

**Interfaces:**
- Consumes: `GET /api/auth/sessions`, `DELETE /api/auth/sessions/<id>`, `POST /api/auth/sessions/revoke-others` (Task 4).

- [ ] **Step 1: Implement the component**

```tsx
// src/app/settings/active-sessions.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { MonitorSmartphone } from "lucide-react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Sess {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string;
  current: boolean;
}

export function ActiveSessions() {
  const [sessions, setSessions] = useState<Sess[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/sessions", { cache: "no-store" });
      const data = (await res.json()) as { sessions: Sess[] };
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function revoke(id: string) {
    const res = await fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Session revoked");
      void refresh();
    } else {
      toast.error("Could not revoke session");
    }
  }

  async function revokeOthers() {
    const res = await fetch("/api/auth/sessions/revoke-others", { method: "POST" });
    if (res.ok) {
      toast.success("Signed out other sessions");
      void refresh();
    } else {
      toast.error("Could not sign out other sessions");
    }
  }

  const others = (sessions ?? []).filter((s) => !s.current).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="size-4" />
          Active sessions
        </CardTitle>
        <CardDescription>
          Devices currently signed in. Revoke any you don&apos;t recognize.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions === null ? (
          <Skeleton className="h-16 w-full" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {s.userAgent}
                    {s.current ? (
                      <span className="ml-2 text-xs text-emerald-600">this device</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    last active {new Date(s.lastSeenAt).toLocaleString()}
                  </p>
                </div>
                {!s.current ? (
                  <Button size="sm" variant="outline" onClick={() => revoke(s.id)}>
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {others > 0 ? (
          <Button size="sm" variant="outline" onClick={revokeOthers}>
            Sign out all other sessions
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Render it in settings-client.tsx**

Open `src/app/settings/settings-client.tsx`, import the component, and render it directly after `<SecuritySettings />` in the same security section:

```tsx
import { ActiveSessions } from "./active-sessions";
```

and in the JSX, immediately following the `<SecuritySettings />` element:

```tsx
        <ActiveSessions />
```

- [ ] **Step 3: Verify it builds/renders**

Run: `npx vitest run src/app/settings` (if any settings tests exist) — expected PASS or "no tests".
Run: `npm run typecheck` — expected no errors (confirms the component + import wiring type-check).

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/active-sessions.tsx src/app/settings/settings-client.tsx
git commit -m "feat(settings): active-sessions device list with revoke + sign-out-others"
```

---

### Task 6: Docs + full gate

**Files:**
- Modify: `README.md` (security section), `AGENTS.md` (auth/session note if present)

- [ ] **Step 1: Document sessions**

In the README security section, add a short "Sessions" note: signing in creates a server-side session (listed under Settings → Active sessions); logging out revokes it; changing the password signs out every device; sessions expire after 7 days idle or 30 days absolute; upgrading from a prior version signs everyone out once (the old cookie format is no longer valid).

- [ ] **Step 2: AGENTS.md**

If `AGENTS.md` documents the auth/session model, update it to note sessions are server-side records in `~/.baklava/sessions.json` (revocable; sliding 7d idle / 30d absolute), and the cookie carries `<sessionId>.<hmac>`. If there is no such note, skip.

- [ ] **Step 3: Full gate**

Run: `npm run typecheck` → no errors.
Run: `npm run lint` → no errors.
Run: `npm run test` → all green (new sessions/session-token/sessions-route tests + existing auth tests).
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document server-side sessions, revocation, and forced re-login on upgrade"
```

---

## Self-Review

**Spec coverage** (spec §4 Session Management):
- Session revocation → `revokeSession` + logout (Task 3) + `DELETE /sessions/[id]` (Task 4). ✅
- Short-lived / sliding sessions → idle 7d slide + absolute 30d cap in `verifySession` (Task 1). ✅
- Server-side records → `sessions.json` store (Task 1). ✅
- Device/session management → list API + Settings card (Tasks 4-5). ✅
- Session rotation → password change revokes all + issues fresh (Task 3). ✅
- Secure logout → logout revokes server-side, not just cookie clear (Task 3). ✅
- Multi-device → each login is its own record; list shows all (Tasks 1,4,5). ✅
- Per-install epoch for logout-everywhere → achieved more simply by `revokeAllExcept(null)` on password change and `revoke-others` for the user-initiated case; no separate epoch concept (YAGNI). ✅ (documented choice)
- `verifySessionToken` signature preserved for `proxy.ts`/`layout.tsx`. ✅

**Placeholder scan:** no TBD/TODO; complete code in every code step. ✅

**Type consistency:** `SessionRecord` fields (`id/createdAt/lastSeenAt/expiresAt/userAgent`) are consistent across store, API mapping, and UI `Sess`. `createSessionToken(userAgent?)`, `verifySessionToken(token)`, `revokeSessionToken(token)`, `sessionIdFromToken(token)`, `revokeAllExcept(keepId)`, `listSessions()`, `revokeSession(id)` names match across Tasks 1-5. ✅

## Out of scope (follow-ups)
- Persisting the sliding `lastSeenAt` on every request (currently throttled to ≤ every 5 min to bound disk writes — acceptable; exact last-seen is approximate).
- CSRF tokens on auth POSTs (separate concern; `SameSite=Lax` already blocks cross-site POST).
- Geo/IP enrichment of the device list (only user-agent is recorded).
