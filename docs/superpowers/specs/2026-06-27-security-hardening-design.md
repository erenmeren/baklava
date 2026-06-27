# Security Hardening Design

Date: 2026-06-27
Status: Approved (design); pending implementation plan
Scope: One spec, five areas, each independently shippable

## Context

Baklava is an open-source, self-hosted, local-first operations console. It holds
credentials for many backends and ships an AI assistant that can act on them. A
security review surfaced five high-priority gaps. This spec designs fixes
optimized for security, simplicity, maintainability, and DX — not enterprise
complexity.

Two existing primitives are reused throughout:

- **The `~/.baklava` store pattern** — `globalThis`-cached, atomic write-then-rename,
  mode 0600 JSON, with the `optionalDependencies` + lazy-import convention used by
  the DB drivers.
- **`src/lib/ai/gate.ts`** — the single server-side chokepoint every AI tool call
  passes through (`isAllowed` → `needsApproval` → execute → audit).

### Decisions locked

- **Credential key custody: keychain-first, env fallback, master-password last
  resort.** Desktop pulls/stores the master key in the OS keychain (zero prompt);
  Docker/headless uses `BAKLAVA_MASTER_KEY`; a machine with neither falls back to a
  master-password prompt.
- All five areas ship as one spec but in the build order below; each is its own
  implementation plan → PR.

---

## 1. Encrypt Credentials at Rest

### Threat model

Defends against an attacker with **filesystem read but not runtime code-exec**:
stolen laptop without full-disk encryption, synced/backed-up dotfile, leaked
container image layer, stray `.bak`, or another process running as the same user.
Does **not** defend against an attacker already executing as the Baklava process
(they read decrypted secrets from memory — out of scope). Encryption-at-rest only
helps if the key lives somewhere other than next to the ciphertext, so this is
primarily a key-custody problem.

### Options considered

- **A. Encrypt only secret fields** (reuse `SECRET_KEYS`). Smaller change, file stays
  partly readable, but leaks metadata and threads crypto through
  `redactConfig`/`mergeConfig`.
- **B. Encrypt the whole records blob** (plaintext header + one AEAD ciphertext).
  Simplest model, leaks nothing, matches the store's whole-file load/save. Can't
  `cat` the file to debug.
- **Cipher: AES-256-GCM (node:crypto) vs XChaCha20-Poly1305 (libsodium).** GCM is
  zero-dep, 96-bit nonce (safe with random nonces at our volume). XChaCha is
  best-in-class (192-bit nonce) but adds a native dep this repo already struggles
  to bundle.

### Recommendation

**Envelope encryption, whole-blob, AES-256-GCM, layered key custody.**

- A random 256-bit **DEK** encrypts the records blob. The DEK is wrapped by a
  **KEK** resolved in order: `BAKLAVA_MASTER_KEY` env → OS keychain entry →
  master-password (Argon2id-derived). File = plaintext header
  `{version, kdf, wrappedDEK, nonce}` + ciphertext. Envelope buys cheap rotation:
  re-wrap the DEK to rotate the KEK (no data re-encrypt); re-encrypt once to rotate
  the DEK.
- **AES-256-GCM via `node:crypto`** for zero dependencies and no bundling fight.
  XChaCha20-Poly1305 noted as a clean future upgrade if libsodium ever enters the
  tree.
- **Keychain via `@napi-rs/keyring` as an optionalDependency, lazy-loaded** like the
  DB drivers. Absent (bare Linux, no Secret Service) → fall back to env →
  master-password. This is the only platform-specific code; the optional-dep
  pattern absorbs it.

A single `crypto-store` helper wraps load/save so connections.json, loadtests.json,
and any future secret store share one implementation.

### Why long-term

One build works zero-prompt on desktop, env-keyed in Docker, password-unlocked
headless, no code forks. Envelope + AES-GCM gives rotation and "change master
password" without touching encrypted data, and no native-module tax.

### Migration & recovery

- First run post-upgrade: detect plaintext file (no header), generate DEK, wrap with
  resolved KEK, write envelope, move old file to `*.pre-encryption.bak` (0600) with a
  one-time UI notice to delete after verifying. Idempotent. Same for loadtests.json.
- **Recovery (sharp edge):** lose the KEK = data gone. Mitigate with
  `BAKLAVA_MASTER_KEY` as portable escape hatch and a "reveal/back up recovery key"
  action in Settings for keychain users. Credentials are re-enterable, so worst case
  is re-adding connections.
- **Performance:** one AEAD op on a KB-sized file at startup/save; Argon2id (~150ms)
  only on the password path.

### Industry precedent

Docker Desktop `credsStore` (osxkeychain/wincred/secretservice), git credential
helpers, 1Password/Vault envelope encryption, Vault seal/unseal (the
master-password fallback), `age` (simple-key file encryption).

---

## 2. AI Safety for Destructive Operations

### Threat model

(1) User over-permissions once (autonomous + destructive + no-confirm) and the model
loops; (2) **prompt injection from tool results** — a table row, container name, or
log line steers the model to a destructive tool (results flow back into the model
unsanitized in `agent.ts`); (3) wrong-target (prod vs staging); (4) correct-looking
but irreversible action with no preview. `gate.ts` already enforces
`isAllowed`/`needsApproval` server-side with safe defaults; the hole is the
autonomous auto-execute path plus no preview.

### Options considered

- **A. Always per-call human approval for destructive; remove the no-confirm escape.**
  Safest, trivial; kills bulk ops (40 deletes = 40 clicks).
- **B. Plan → Review → Execute.** Model proposes a plan (resolved calls + risk score),
  executes nothing; UI renders a reviewable checklist with blast radius; user
  approves the plan once (or per item); execution runs only the approved set.
- **C. Per-call confirm + risk scoring + batch-approve.** Smaller change, weaker
  preview.

### Recommendation

**B (Plan → Review → Execute), with "destructive always needs approval" made
non-disableable, but approval granted at the plan level.** Revised policy semantics:

- `read` → auto.
- `write` → confirm in confirm-mode; autonomous auto unless risk-flagged.
- `destructive` → **always** requires explicit approval (no silent setting), but
  approval is on the resolved plan, so a bulk batch is one approval.

Supporting pieces:

- **Dry-run/preview as the plan's evidence:** SQL via `EXPLAIN` or rolled-back
  `READ ONLY` count; deletes via count/list; show "affects N."
- **Risk score** = category × target sensitivity (prod-tagged) × blast radius (rows/
  objects, wildcards) × reversibility (DROP vs DELETE-WHERE). Decides whether writes
  auto-run in autonomous mode and UI loudness. High-risk → typed confirmation.
- **Injection containment by architecture:** the human sees the resolved destructive
  plan before anything runs, so injected intent surfaces as a rejectable item. Keep
  the "results are data" system-prompt rule and mark tool-result content untrusted,
  but do not rely on them. Tool results never auto-trigger destructive execution
  without re-entering plan approval.
- **Approval binding + expiry:** approval bound to a hash of the resolved calls,
  expires (~5 min). **Persist pending approvals to disk** (fixes the in-memory
  `pending.ts` restart hang).
- **Undo: deliberately minimal.** No generic cross-backend undo. Capture-before-
  destroy for cheap cases (Redis value, single-row delete) into the audit log; lean
  on backend-native versioning (S3); DROP / delete-bucket are irreversible and
  require typed confirmation.

### Why long-term

Plan→Review→Execute is the only model that keeps autonomy and safety: scales 1→100
actions, is the natural home for risk scoring and dry-run, and is the structural
answer to prompt injection. Testable as a pure function (plan in, decisions out).

### Trade-offs / migration

Chat flow gains a plan-approval step; policy schema changes (drop
`confirmDestructive:false`, add risk thresholds); existing policies migrate to
"destructive always confirmed." Power users lose true fire-and-forget; bulk-approve
is the compensation.

### Industry precedent

Terraform `plan`→`apply` (canonical), `kubectl --dry-run=server`, CloudFormation
Change Sets, GitHub Actions protected-environment reviewers, agent step-caps.

---

## 3. Reduce SSRF Attack Surface

### Threat model

An authenticated user (or the AI under injection) makes the **server** connect to
addresses it shouldn't: cloud metadata (169.254.169.254, `fd00:ec2::254`, GCP
`metadata.google.internal`, Alibaba 100.100.100.200), link-local, or internal
services reachable only from the server. Surfaces: loadtest `baseUrl` (k6 container +
our `host.docker.internal`), health probe TCP (`health.ts`), connection "test"
flows, blob endpoint overrides, registry URLs. Wrinkle: Baklava's job is connecting
to arbitrary user infra including RFC1918 and localhost, so a flat "block private
IPs" breaks the core use case.

### Options considered

- **A. Allowlist (deny by default).** Most secure, wrong for this product.
- **B. Flat blocklist (block all private + metadata).** Breaks legitimate internal
  connections.
- **C. Contextual egress policy.** Separate two egress classes (drivers/probes vs the
  generic loadtest fetcher) and apply different defaults.

### Recommendation

**C, expressed as one egress policy** with secure default + advanced override:

- **Always, everywhere:** block metadata + link-local (no legitimate Baklava use hits
  169.254).
- **Drivers/probes:** allow private + loopback (required).
- **Loadtest:** block private + loopback unless a per-test "target is on my local
  network" opt-in is set; keep the `localhost → host.docker.internal` rewrite.
- **Advanced override:** `BAKLAVA_EGRESS_ALLOW=10.0.0.0/8,…` + a Settings toggle.

Load-bearing implementation detail: **validate after DNS resolution, then pin.**
Resolve the host, check every resolved A/AAAA against the blocklist, dial the
validated literal IP (keep original Host/SNI). Defeats DNS rebinding / TOCTOU. In
Node: a custom `lookup`/agent rejecting disallowed resolved addresses. For **k6**
(own DNS in-container): validate+resolve `baseUrl` in Node pre-launch and pass a
pinned target, and run k6 on a locked-down Docker network with no route to the
metadata IP.

### Why long-term

One egress-policy module that drivers, probes, k6, blob, and registries all route
through means SSRF is enforced in one auditable place; secure default ships on; the
homelab user still reaches their LAN via one obvious toggle. Resolve-then-pin closes
the rebinding class instead of string-matching whack-a-mole.

### Trade-offs / migration

Resolve-then-pin can interfere with virtual-hosting/SNI (mitigate by preserving
Host/SNI). Metadata-block-everywhere is the quick first win; k6 network isolation
lands second.

### Industry precedent

GitHub webhook/Pages SSRF protections, AWS IMDSv2 (token + hop-limit), OWASP SSRF
cheat sheet (resolve→validate→pin), `request-filtering-agent` / `ssrf-req-filter`.

---

## 4. Improve Session Management

### Threat model

A token outliving logout, a stolen cookie/token usable for 30 days, no way to kill a
session from a lost device. XSS largely handled (httpOnly + React escaping), so the
realistic vectors are stolen-laptop and "logged in somewhere I no longer control."
Full OAuth/refresh infra is overkill for a self-hosted single-operator/tiny-team
tool.

### Options considered

- **A. Stateless access + refresh tokens (OAuth-style).** Powerful, heavy; overkill.
- **B. Server-side session records.** Cookie carries a random session id; store holds
  `{id, createdAt, lastSeen, userAgent, expiry}`; verify = lookup → instant
  revocation, device list, logout-everywhere, sliding expiry.
- **C. Stateless + revocation epoch.** Per-install epoch (bump = invalidate all) +
  small denylist; lighter, but no device list/metadata.

### Recommendation

**B, reusing the store pattern,** plus one idea from C. Random session id in an
httpOnly + SameSite=Lax + secure cookie; sessions in `~/.baklava/sessions.json`
(0600); **sliding idle expiry** (~7 days, bumped on activity) under an absolute cap
(~30 days). Keep the HMAC signature on the cookie value as a cheap pre-filter, but
the store is source of truth. Add a per-install **epoch** so "change password" /
"log out everywhere" is a single bump. Settings gets a "where you're logged in" list
(last-seen + user agent + revoke); rotate session id on password change.

### Why long-term

Real logout, real revocation, and the device list are what users ask for, at trivial
storage cost because it reuses the existing json + globalThis + atomic-write pattern.
No token-refresh dance.

### Trade-offs / migration

Existing 30-day cookies invalidate on upgrade: one forced re-login, documented. One
store lookup per request, negligible.

### Industry precedent

GitHub "Sessions / where you're logged in," Django/Rails server-side sessions,
Tailscale/1Password device lists. Anti-pattern: long-lived unrevocable JWTs.

---

## 5. AI Rate Limiting & Emergency Controls

### Threat model

A model in autonomous mode (or under injection) bursts destructive calls; a runaway
loop; token/cost blowup; an in-flight action the user must stop now. `gate.ts` has
none of these today.

### Recommendation

Build all of these into `gate.ts` (and the agent loop) — the one server-side
chokepoint every tool funnels through. Defaults tuned so a human-paced session never
notices; only burst/runaway patterns trip anything.

1. **Token-bucket rate limits, category-weighted, per session+connection.** Generous
   overall cap, stricter destructive cap. Cheapest, highest-leverage.
2. **Circuit breaker on consecutive/burst destructive ops.** After K in a window →
   halt + force re-confirmation, then a short cooldown.
3. **Two emergency stops:** per-run **AbortController** wired to an always-visible
   "Stop" button (extends the existing SSE/fetch abort path to the tool loop and
   cancellable driver ops), and a **persisted global kill switch** (store flag + red
   "Stop all AI" control + env/file) that makes `gate.ts` refuse every non-read tool
   immediately and survives restart.
4. **Per-session budget:** caps on tool-call count and model tokens; exceed → halt
   with a clear message. Kills loops and cost blowups.
5. **Lightweight anomaly counters** feeding the breaker: same destructive tool
   repeated, escalating blast radius, acting on an unnamed connection, a destructive
   call right after reading injection-looking content. On trip → downgrade to
   confirm-everything and alert. Counters/patterns, not ML.

### Why long-term

The chokepoint already exists with audit logging; adding buckets + breaker + abort +
kill switch there is small, centralized, unit-testable, and converts "the model can
spam destruction" into a bounded, observable system. Generous defaults keep DX
smooth; Stop button and kill switch are always present.

### Trade-offs / migration

Mostly additive (kill-switch flag + budget config). Only DX risk is limits set too
tight; mitigate by tuning to human pace and making any trip explain itself and offer
"continue."

### Industry precedent

Kubernetes API Priority & Fairness, Stripe/GitHub token-bucket limits,
resilience4j/Hystrix circuit breakers, LaunchDarkly kill switches, AWS Budgets,
agent max-step caps.

---

## Composition & Build Order

`gate.ts` becomes the security chokepoint for both AI surfaces (#2 plan-approval,
#5 limits/breaker/kill-switch/abort, plus existing audit). The `~/.baklava` store
pattern is reused for encrypted credentials (#1), sessions (#4), pending approvals
(#2), and policy/kill-switch state (#5).

Suggested sequencing, each independently shippable:

- **P0 (storage layer, low blast radius):** #1 credential encryption + #4 sessions.
- **P0/P1 (small, removes the scariest AI failure):** #5 gate controls (rate limit +
  kill switch + abort first; breaker/anomaly next).
- **P1 (bigger UX change):** #2 plan → review → execute + persisted approvals.
- **P1 (quick metadata-block now, k6 isolation later):** #3 egress policy.

### Migration challenges (flagged up front)

- One forced re-login (#4).
- One-time plaintext → encrypted migration with a `.pre-encryption.bak` backup (#1).
- Chat-flow change to plan approval, plus a policy-schema migration (#2).

## Testing approach

- **#1:** round-trip encrypt/decrypt; KEK resolver order (env > keychain > password);
  migration from plaintext is idempotent and writes the backup; tamper detection
  (AEAD auth failure) on a corrupted file; wrong-key fails cleanly.
- **#2:** plan generation never executes; approval bound to resolved-call hash;
  expired/mutated approval rejected; destructive cannot be set to silent; injected
  "drop" content appears as a rejectable plan item, not an execution.
- **#3:** metadata/link-local blocked everywhere; private allowed for drivers, blocked
  for loadtest unless opt-in; DNS-rebinding case (hostname resolving to a blocked IP)
  is rejected after resolution.
- **#4:** logout deletes the record and the cookie no longer authenticates; epoch
  bump invalidates all sessions; sliding expiry; revoke-from-device-list.
- **#5:** bucket limits trip on burst and not on human pace; breaker halts after K
  destructive; global kill switch blocks non-read tools and persists; AbortController
  stops an in-flight run; budget cap halts a loop.

## Out of scope (YAGNI for now)

- Multi-user accounts / RBAC (separate, larger effort).
- OAuth / refresh-token infrastructure.
- Generic cross-backend undo.
- ML-based anomaly detection (counters/heuristics only).
