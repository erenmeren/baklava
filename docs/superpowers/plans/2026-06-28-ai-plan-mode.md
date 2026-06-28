# AI Plan Mode — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Opt-in plan→review→execute for the assistant, augmenting the per-action gate.

**Global Constraints**
- Plan mode is additive + opt-in; default OFF must leave today's behavior and all
  existing tests unchanged.
- `propose_plan` has NO side effects; reuses `createPending`/`resolvePending`.
- Never bypass per-action gate / kill switch / rate limit / policy / RBAC access.
- Tests isolate via temp BAKLAVA_DATA_DIR + cache resets where they touch stores.

### Task 1: `propose_plan` tool + plan approval plumbing
**Files:** create `src/lib/ai/plan-tool.ts`, test `src/lib/ai/plan-tool.test.ts`. Read `src/lib/ai/pending.ts`, `src/lib/ai/conversation-tools.ts` (how awaitApproval/emit are wired), `src/lib/ai/tools/types.ts`.
**Produces:**
```ts
export interface PlanStep { tool: string; connection?: string; summary: string }
export function makeProposePlanTool(ctx: { sessionId: string; emit: (e:string,d:unknown)=>void; awaitDecision: (toolCallId: string, payload: { steps: PlanStep[]; rationale?: string }) => Promise<boolean> }): PreparedTool-like;
```
Behavior: an AiTool/prepared tool named `propose_plan`, category `read`, input schema `{ steps: {tool, connection?, summary}[], rationale? }`. Its run emits `plan` `{ toolCallId, steps, rationale }` and returns `{ approved }` from `awaitDecision`. `awaitDecision` default impl = `createPending(sessionId, toolCallId)`.
- [ ] Test: run emits `plan` with steps + toolCallId; returns {approved:true} when resolvePending(...true); {approved:false} when false. No side effects.
- [ ] Implement; `npm test -- plan-tool` green; typecheck 0.
- [ ] Commit `feat(ai): propose_plan tool + plan approval plumbing`.

### Task 2: chat route + agent wiring
**Files:** modify `src/app/api/ai/chat/route.ts` (+ test). Read how `systemExtra` + tools + the approval SSE/decision are built today.
Behavior: accept `planMode?: boolean` in the request body. When true: append the plan directive (from the spec) to `systemExtra`, and add the `propose_plan` tool (built via Task 1, wired to the same `emit` + a pending-based decision keyed by sessionId+toolCallId) to the tool set passed to `runAgent`. The existing per-action approval + gates are unchanged. When false/absent: no directive, no tool — identical to today.
- [ ] Test: planMode true → systemExtra contains the directive AND tool set includes `propose_plan`; planMode false → neither (assert on the prepared inputs; mock runAgent or assert the assembled config).
- [ ] Implement; `npm test -- chat`/`ai` green; typecheck 0.
- [ ] Commit `feat(ai): plan mode flag wires propose_plan + directive`.

### Task 3: client — toggle + PlanCard
**Files:** create `src/components/ai/plan-card.tsx`; modify `src/app/assistant/assistant-client.tsx`. Read `src/components/ai/approval-card.tsx` (mirror its decision wiring) and how the assistant subscribes to SSE events + posts approval decisions.
Behavior:
- `PlanCard({ plan: { toolCallId, steps, rationale }, onDecision })` — lists steps (tool + connection + summary), Approve / Reject buttons → `onDecision(toolCallId, "approve"|"reject")` using the SAME decision path as ApprovalCard.
- Assistant: a Plan-mode toggle (composer area, near the model picker), per-conversation, persisted to localStorage `baklava:plan-mode:${conversationId}`; send `planMode` in the chat POST body; subscribe to the `plan` SSE event and render a PlanCard inline in the message stream; resolve via the existing decision POST.
- base-ui conventions; no asChild.
- [ ] Implement; typecheck 0; eslint clean; build succeeds.
- [ ] Commit `feat(ai): plan-mode toggle + PlanCard`.

### Task 4: docs + smoke
**Files:** README.md (assistant section: plan mode), AGENTS.md (AI gate area: plan mode augments, never bypasses). Optional e2e smoke that the toggle is present.
- [ ] Update docs; `npm test` full green; `npm run build`.
- [ ] Commit `docs(ai): document plan mode`.

## Final review: whole-branch review (merge-base main..HEAD), fix Critical/Important, then finish branch.
