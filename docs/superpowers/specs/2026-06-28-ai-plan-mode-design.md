# AI Plan → Review → Execute — Design Spec

**Goal:** Add an opt-in "Plan mode" to the assistant. When on, the assistant must
present an ordered plan of the actions it intends to take and get a single
approval BEFORE it acts. Execution then proceeds with all existing gates intact —
this AUGMENTS the per-action gate, it does not replace it.

**Decision (locked):** Augment. Plan approval is an ADDITIONAL up-front step.
Destructive actions still hit the existing per-action approval gate during
execution; the kill switch, rate limits, per-connection policy, and per-user
access (RBAC) all still apply. Plan mode never lowers any guard.

## Model of operation

- Plan mode is a per-conversation toggle (default OFF → today's behavior exactly).
- When ON, the chat route injects a system directive and registers one extra
  built-in tool, `propose_plan`:
  > Before performing ANY write or destructive action, you MUST first call
  > `propose_plan` with the ordered steps you intend to take, then wait. Only
  > after it returns `{ approved: true }` may you execute. Pure read/inspect
  > actions do not require a plan. If it returns `{ approved: false }`, stop and
  > explain.
- `propose_plan({ steps: [{ tool, connection?, summary }], rationale? })`:
  - emits an SSE `plan` event `{ toolCallId, steps, rationale }`;
  - awaits a single decision via the EXISTING pending infra
    (`createPending(sessionId, toolCallId)` / `resolvePending`), reusing the same
    decision endpoint the per-action approval card already uses;
  - returns `{ approved: true }` or `{ approved: false }` to the model.
- The client renders a `PlanCard` (sibling of `ApprovalCard`) listing the steps
  with Approve / Reject; the decision posts to the same approval-decision route.
- After approval the model executes the real tools; each destructive tool call
  still raises the per-action ApprovalCard (the backstop). So the user may see:
  one PlanCard (intent) + N destructive ApprovalCards (per dangerous step).

## Why this shape

- Reuses the entire existing approval transport (pending map, SSE event pattern,
  decision endpoint) — minimal new surface.
- `propose_plan` is a normal tool, so it flows through `runAgent` unchanged; no
  fork of the agent loop.
- Plan mode is additive and opt-in, so default behavior and all existing tests
  are untouched.

## Components

1. `propose_plan` built-in tool (server) — category "read" (proposing is not an
   action), emits `plan`, awaits approval. NOT connection-scoped. Registered only
   when plan mode is on.
2. Chat route (`src/app/api/ai/chat/route.ts`): accept a `planMode: boolean` flag
   on the request; when true, add the directive to `systemExtra` and add
   `propose_plan` to the tool set with a context carrying `sessionId` + `emit` +
   the pending-based approval.
3. Client (`assistant-client.tsx`): a Plan-mode toggle in the composer/header
   (per-conversation, persisted to localStorage keyed by conversationId);
   send `planMode` in the chat POST; render `PlanCard` on the `plan` SSE event;
   wire Approve/Reject to the existing decision POST.
4. `PlanCard` component (`src/components/ai/plan-card.tsx`).

## Security invariants

- Plan mode NEVER bypasses the per-action gate, kill switch, rate limits,
  per-connection policy, or per-user access. It only ADDS an approval.
- `propose_plan` performs no side effects; it cannot be used to execute anything.
- The plan decision reuses the authenticated decision endpoint (same auth as
  per-action approvals); a plan for session A cannot be resolved by session B
  (pending is keyed by sessionId).
- Steps shown in the PlanCard are model-proposed DATA; render as text, never
  execute from them.

## Out of scope (YAGNI)

- Editing/reordering plan steps in the UI (approve/reject only).
- Persisting plans to disk or replaying them.
- Auto-execution without the per-action gate (explicitly rejected by the decision).

## Testing

Unit: `propose_plan` emits `plan` + resolves via pending (approved/!approved);
chat route registers the tool + directive only when `planMode` true; default
(planMode false) unchanged. Component: PlanCard renders steps + fires decision.
E2e/smoke: the Plan-mode toggle is present in the assistant and persists.
