# SSRF Egress Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the server from being aimed at cloud-metadata / link-local endpoints via user-supplied URLs (load-test target, health reachability probe), with resolve-then-pin to defeat DNS rebinding, while keeping private/loopback targets working for the homelab use case.

**Architecture:** One server-only module `src/lib/net/egress.ts` classifies an IP and exposes `assertHostAllowed(host, opts)` which resolves the host (DNS), checks every resolved address, and returns the resolved IPs (for pinning) or throws `EgressBlockedError`. The default policy blocks **metadata + link-local always**, and allows private/loopback (the product connects to private infra on purpose). A `BAKLAVA_EGRESS_ALLOW` env list re-allows specific IPs (escape hatch). Two call sites enforce it: the health fallback `tcpProbe` (resolve + pin + block) and the load-test `baseUrl` validation (pre-launch).

**Tech Stack:** TypeScript, Node `node:dns/promises` + `node:net`, vitest.

## Global Constraints

- Server-only module: `import "server-only"`. Node runtime only.
- Default policy: ALWAYS block `metadata` (169.254.169.254, fd00:ec2::254) and `link-local` (169.254.0.0/16, fe80::/10). Allow `loopback` and `private` by default (`allowPrivate`/`allowLoopback` opt-outs exist but default true).
- Override: `BAKLAVA_EGRESS_ALLOW` = comma-separated exact IPs that bypass the block (CIDR support is a follow-up, not this plan).
- Resolve-then-pin: validate the resolved IP(s) and connect to the validated IP, not re-resolve, at the call sites we control (health `tcpProbe`).
- Tests must not hit real DNS: `assertHostAllowed` takes an injectable `lookup`; tests pass IP literals or a fake lookup.
- Do not touch the typed driver connections (pg/mysql/redis/etc.) — they connect to private infra by design and resolve internally; egress enforcement here covers the user-supplied-URL vectors only.
- Existing tests stay green.

**Deviation from spec (recorded):** spec §3 also said the load tester should default-block private+loopback unless a per-test opt-in. That would break the primary "load test my localhost/LAN service" use case by default and needs a schema+form+UI change, so it is deferred as a follow-up. This plan implements the non-negotiable, highest-value part (metadata/link-local block everywhere + resolve-then-pin + override).

---

### Task 1: Egress classification + guard module

**Files:**
- Create: `src/lib/net/egress.ts`
- Test: `src/lib/net/egress.test.ts`

**Interfaces:**
- Consumes: nothing (`node:dns/promises`, `node:net`).
- Produces:
  - `class EgressBlockedError extends Error` (fields `host`, `ip`, `category`)
  - `type IpCategory = "metadata" | "link-local" | "loopback" | "private" | "public"`
  - `classifyIp(ip: string): IpCategory`
  - `interface EgressOptions { allowPrivate?: boolean; allowLoopback?: boolean; lookup?: (host: string) => Promise<string[]> }`
  - `assertHostAllowed(host: string, opts?: EgressOptions): Promise<string[]>` (returns resolved IPs, or throws `EgressBlockedError`)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/net/egress.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { classifyIp, assertHostAllowed, EgressBlockedError } from "./egress";

afterEach(() => {
  delete process.env.BAKLAVA_EGRESS_ALLOW;
});

describe("classifyIp", () => {
  it("classifies v4", () => {
    expect(classifyIp("169.254.169.254")).toBe("metadata");
    expect(classifyIp("169.254.1.1")).toBe("link-local");
    expect(classifyIp("127.0.0.1")).toBe("loopback");
    expect(classifyIp("10.1.2.3")).toBe("private");
    expect(classifyIp("172.16.0.1")).toBe("private");
    expect(classifyIp("192.168.1.5")).toBe("private");
    expect(classifyIp("8.8.8.8")).toBe("public");
  });
  it("classifies v6", () => {
    expect(classifyIp("::1")).toBe("loopback");
    expect(classifyIp("fe80::1")).toBe("link-local");
    expect(classifyIp("fd00:ec2::254")).toBe("metadata");
    expect(classifyIp("fd12::1")).toBe("private");
    expect(classifyIp("2606:4700::1")).toBe("public");
  });
});

describe("assertHostAllowed", () => {
  const lookup = (map: Record<string, string[]>) => (h: string) => Promise.resolve(map[h] ?? []);

  it("blocks metadata regardless of host", async () => {
    await expect(
      assertHostAllowed("metadata.evil.com", { lookup: lookup({ "metadata.evil.com": ["169.254.169.254"] }) }),
    ).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("blocks link-local", async () => {
    await expect(assertHostAllowed("169.254.1.1")).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("allows private + loopback by default (homelab)", async () => {
    expect(await assertHostAllowed("10.0.0.5")).toEqual(["10.0.0.5"]);
    expect(await assertHostAllowed("127.0.0.1")).toEqual(["127.0.0.1"]);
  });

  it("blocks private when allowPrivate is false", async () => {
    await expect(assertHostAllowed("10.0.0.5", { allowPrivate: false })).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it("allows a public host and returns resolved IPs", async () => {
    expect(await assertHostAllowed("api.example.com", { lookup: lookup({ "api.example.com": ["93.184.216.34"] }) }))
      .toEqual(["93.184.216.34"]);
  });

  it("BAKLAVA_EGRESS_ALLOW re-allows a blocked IP", async () => {
    process.env.BAKLAVA_EGRESS_ALLOW = "169.254.169.254";
    expect(await assertHostAllowed("169.254.169.254")).toEqual(["169.254.169.254"]);
  });

  it("throws when a host does not resolve", async () => {
    await expect(assertHostAllowed("nope.invalid", { lookup: lookup({}) })).rejects.toBeInstanceOf(EgressBlockedError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/net/egress.test.ts`
Expected: FAIL — cannot find module `./egress`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/net/egress.ts
import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

export type IpCategory = "metadata" | "link-local" | "loopback" | "private" | "public";

export class EgressBlockedError extends Error {
  constructor(
    public host: string,
    public ip: string,
    public category: string,
  ) {
    super(`Egress to ${host}${ip ? ` (${ip})` : ""} blocked: ${category}`);
    this.name = "EgressBlockedError";
  }
}

export function classifyIp(ip: string): IpCategory {
  if (net.isIPv4(ip)) {
    if (ip === "169.254.169.254") return "metadata";
    const o = ip.split(".").map(Number);
    if (o[0] === 127 || o[0] === 0) return "loopback";
    if (o[0] === 169 && o[1] === 254) return "link-local";
    if (o[0] === 10) return "private";
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return "private";
    if (o[0] === 192 && o[1] === 168) return "private";
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return "private"; // CGNAT
    return "public";
  }
  const a = ip.toLowerCase();
  if (a === "::1") return "loopback";
  if (a === "fd00:ec2::254") return "metadata";
  if (a.startsWith("::ffff:")) return classifyIp(a.slice("::ffff:".length)); // v4-mapped
  // fe80::/10 link-local: fe8, fe9, fea, feb prefixes
  if (/^fe[89ab]/.test(a)) return "link-local";
  // fc00::/7 unique-local
  if (a.startsWith("fc") || a.startsWith("fd")) return "private";
  return "public";
}

const ALWAYS_BLOCK: ReadonlySet<IpCategory> = new Set<IpCategory>(["metadata", "link-local"]);

function allowList(): string[] {
  return (process.env.BAKLAVA_EGRESS_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface EgressOptions {
  allowPrivate?: boolean; // default true
  allowLoopback?: boolean; // default true
  lookup?: (host: string) => Promise<string[]>;
}

export async function assertHostAllowed(host: string, opts: EgressOptions = {}): Promise<string[]> {
  const allowPrivate = opts.allowPrivate !== false;
  const allowLoopback = opts.allowLoopback !== false;
  const allowed = allowList();

  const ips = net.isIP(host)
    ? [host]
    : opts.lookup
      ? await opts.lookup(host)
      : (await dns.lookup(host, { all: true })).map((r) => r.address);

  if (ips.length === 0) throw new EgressBlockedError(host, "", "unresolved");

  for (const ip of ips) {
    if (allowed.includes(ip)) continue;
    const cat = classifyIp(ip);
    if (ALWAYS_BLOCK.has(cat)) throw new EgressBlockedError(host, ip, cat);
    if (cat === "private" && !allowPrivate) throw new EgressBlockedError(host, ip, cat);
    if (cat === "loopback" && !allowLoopback) throw new EgressBlockedError(host, ip, cat);
  }
  return ips;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/net/egress.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/net/egress.ts src/lib/net/egress.test.ts
git commit -m "feat(net): egress guard — block metadata/link-local, resolve + classify"
```

---

### Task 2: Enforce egress in the health reachability probe (resolve + pin)

**Files:**
- Modify: `src/lib/connections/health.ts` (`reachabilityOnly` / `tcpProbe`)
- Test: `src/lib/connections/health-egress.test.ts`

**Interfaces:**
- Consumes: `assertHostAllowed` (Task 1).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connections/health-egress.test.ts
import { describe, it, expect } from "vitest";
import { probeHealth } from "./health";
import type { ConnectionRecord } from "./types";

describe("health probe egress", () => {
  it("reports down for a metadata-IP endpoint instead of connecting", async () => {
    // A tech with no dedicated driver health probe falls back to reachabilityOnly.
    const conn = {
      id: "x",
      tech: "etcd" as ConnectionRecord["tech"],
      name: "meta",
      config: { host: "169.254.169.254", port: 80 },
      status: "untested",
      createdAt: 1,
    } as unknown as ConnectionRecord;
    const snap = await probeHealth(conn);
    expect(snap.status).toBe("down");
    expect(snap.error ?? "").toMatch(/blocked|metadata/i);
  });
});
```

(If `"etcd"` is not a valid `TechId` in this build, use any `TechId` that has NO `driver.health` so the probe falls back to `reachabilityOnly`. The cast keeps the test compiling regardless.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/connections/health-egress.test.ts`
Expected: FAIL — it currently attempts a real TCP connect to 169.254.169.254 (times out → down, but with a timeout error, not a "blocked" one) OR connects; the `/blocked|metadata/i` assertion fails.

- [ ] **Step 3: Edit `health.ts`**

Add the import near the top:

```ts
import { assertHostAllowed } from "@/lib/net/egress";
```

Replace `reachabilityOnly` so it validates + pins to the resolved IP before connecting:

```ts
async function reachabilityOnly(conn: ConnectionRecord): Promise<ProbeBody> {
  const ep = endpointOf(conn.config);
  if (!ep) return { summary: "No endpoint to probe", metrics: [] };
  // Block metadata/link-local; pin to the validated IP to avoid DNS rebinding.
  const ips = await assertHostAllowed(ep.host);
  await tcpProbe(ips[0], ep.port, PROBE_TIMEOUT_MS);
  return { summary: `Reachable · ${ep.host}:${ep.port}`, metrics: [] };
}
```

(`assertHostAllowed` throws `EgressBlockedError` for metadata/link-local; `probeHealth` already catches and reports `status: "down"` with the error message.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/connections/health-egress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/health.ts src/lib/connections/health-egress.test.ts
git commit -m "feat(health): block metadata/link-local in the reachability probe (resolve + pin)"
```

---

### Task 3: Validate the load-test target before launching k6

**Files:**
- Modify: `src/lib/loadtest/run-load-test.ts`
- Test: `src/lib/loadtest/run-egress.test.ts`

**Interfaces:**
- Consumes: `assertHostAllowed` (Task 1); `normalizeBaseUrl` (existing, `./url`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/run-egress.test.ts
import { describe, it, expect } from "vitest";
import { runLoadTest } from "./run-load-test";

const cfg = {
  name: "ssrf",
  target: { baseUrl: "http://169.254.169.254/latest/meta-data" },
  requests: [{ name: "r", method: "GET", path: "/" }],
  auth: { type: "none" },
  profile: { type: "constant", vus: 1, duration: "1s" },
  thresholds: undefined,
};

describe("loadtest egress", () => {
  it("refuses a metadata-IP target before running k6", async () => {
    await expect(runLoadTest(cfg)).rejects.toThrow(/blocked|metadata/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/run-egress.test.ts`
Expected: FAIL — `runLoadTest` currently proceeds to the executor (would try Docker), not a clean egress rejection.

- [ ] **Step 3: Edit `run-load-test.ts`**

Add imports near the top:

```ts
import { assertHostAllowed } from "@/lib/net/egress";
import { normalizeBaseUrl } from "./url";
```

In `runLoadTest`, immediately after the config is parsed (`const config = loadTestConfigSchema.parse(input);`) and before the script is generated / executor is created, insert:

```ts
  // SSRF guard: block metadata/link-local targets before launching k6.
  // Private/loopback stay allowed (the localhost→host.docker.internal rewrite
  // is the intended "test my local service" path).
  const targetHost = new URL(normalizeBaseUrl(config.target.baseUrl)).hostname;
  await assertHostAllowed(targetHost);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/run-egress.test.ts`
Expected: PASS (rejects before any Docker/executor work).

- [ ] **Step 5: Run the existing loadtest suite for no regression**

Run: `npx vitest run src/lib/loadtest`
Expected: all pass (the example/public-URL tests resolve to public IPs and are allowed; any test using `localhost`/example hosts still works — `assertHostAllowed` allows loopback/private and resolves public example hosts).
Note: if a pre-existing unit test calls `runLoadTest` with an unresolvable example host and a mocked executor, and it now fails at DNS resolution, switch that test's `baseUrl` to `http://127.0.0.1:PORT` (loopback is allowed) — do not weaken the egress check.

- [ ] **Step 6: Commit**

```bash
git add src/lib/loadtest/run-load-test.ts src/lib/loadtest/run-egress.test.ts
git commit -m "feat(loadtest): block metadata/link-local targets before launching k6"
```

---

### Task 4: Docs + full gate

**Files:**
- Modify: `README.md`, `AGENTS.md` (if it documents loadtest/health networking)

- [ ] **Step 1: Document the egress policy**

In the README (security or load-test/health section), add a short note: the server blocks outbound requests to cloud-metadata and link-local addresses (e.g. 169.254.169.254) for user-supplied targets (load-test URL, health reachability probe), resolving and pinning the address to prevent DNS rebinding; private/loopback targets remain allowed so you can test/monitor services on your own machine or LAN; `BAKLAVA_EGRESS_ALLOW=<ip,ip>` re-allows specific addresses if you really need them.

- [ ] **Step 2: AGENTS.md**

If `AGENTS.md` documents the load-test or health networking, add a one-line note that user-supplied target hosts pass through `src/lib/net/egress.ts` (`assertHostAllowed`) which blocks metadata/link-local and pins the resolved IP. Otherwise skip.

- [ ] **Step 3: Full gate**

Run: `npm run typecheck` → no errors.
Run: `npm run lint` → no errors.
Run: `npm run test` → all green (new egress/health-egress/run-egress tests + existing suite).
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document SSRF egress policy (metadata/link-local block + override)"
```

---

## Self-Review

**Spec coverage** (spec §3):
- Private IP blocking → available via `allowPrivate:false`; default allows private (homelab) — metadata/link-local always blocked. ✅ (default tuned to product)
- Metadata endpoint protection → always blocked (v4 + v6). ✅
- Allowlists vs blocklists → blocklist default + `BAKLAVA_EGRESS_ALLOW` allow-override. ✅
- DNS rebinding protection → resolve-then-pin in the health probe; pre-launch resolve+validate for loadtest. ✅ (k6's own in-container re-resolution is a noted residual)
- URL validation / network sandboxing → `assertHostAllowed` at the two user-URL call sites. ✅
- Configurable security policies → `EgressOptions` + env override. ✅
- Docker networking isolation for k6 (full in-container pinning) → deferred follow-up.
- Per-test "allow internal" opt-in for loadtest → deferred follow-up (see Deviation).

**Placeholder scan:** no TBD/TODO; complete code in every code step. ✅

**Type consistency:** `assertHostAllowed(host, opts?) → Promise<string[]>`, `classifyIp → IpCategory`, `EgressBlockedError`, `EgressOptions` used consistently across Tasks 1-3. ✅

## Out of scope (follow-ups)
- Loadtest default-block of private/loopback with a per-test "target is on my local network" opt-in (schema + form + UI).
- Full in-container DNS pinning / locked-down Docker network for k6 (residual rebinding window).
- CIDR support in `BAKLAVA_EGRESS_ALLOW` (currently exact-IP).
- Egress enforcement on typed driver connections (pg/mysql/etc.) — they target private infra by design and resolve internally.
