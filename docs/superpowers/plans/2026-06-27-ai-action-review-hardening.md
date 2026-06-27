# AI Action Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI destructive action require human approval (non-disableable), and turn that approval into a real review: a risk level + reasons on each prompt, and a typed confirmation for high-risk destructive actions.

**Architecture:** This is the implementable, architecture-fitting slice of spec §2 (AI plan→review→execute). It keeps the existing per-call approval flow (gate.ts `awaitApproval` → SSE `approval-needed` → `ApprovalCard` → `/api/ai/chat/approve`) but (1) removes the autonomous escape for destructive in `permissions.ts` so destructive ALWAYS pauses for approval, (2) adds a pure `risk.ts` scorer surfaced in the approval payload, and (3) upgrades `ApprovalCard` to show risk and gate high-risk approvals behind a typed confirmation.

**Tech Stack:** TypeScript, the existing AI gate/approval pipeline, React, vitest.

## Global Constraints

- The single enforcement chokepoint stays `src/lib/ai/gate.ts` (`wrapExecute`) → `needsApproval` (`permissions.ts`). Do not add approval logic elsewhere.
- `verifySessionToken`/auth and the #5 rate-limit/kill-switch code are not changed by this plan (the gate ordering kill-switch → isAllowed → approval → limits → execute is preserved).
- Risk scoring is a PURE function (no backend round-trip / no dry-run query in this plan — generic per-backend dry-run is a deferred follow-up).
- Approval semantics after this plan: `read` → never needs approval; `write` → needs approval only in `confirm` mode; `destructive` → ALWAYS needs approval (regardless of mode or `confirmDestructive`). The `confirmDestructive` field stays in the type for back-compat but is ignored for destructive.
- Existing tests must be updated to the new semantics, not deleted: `permissions.test.ts` and the autonomous-destructive case in `gate.test.ts`.

**Deviation from spec (recorded):** spec §2 described a full plan→review→execute phase split (model proposes a whole plan, user approves once, then it executes) plus dry-run blast-radius and undo. A true phase split fights the streaming AI-SDK loop (later steps depend on tool results), so it's deferred as a follow-up. This plan delivers the safety core: no blind destructive execution + a meaningful, risk-scored, typed-confirm review.

---

### Task 1: Risk scoring module

**Files:**
- Create: `src/lib/ai/risk.ts`
- Test: `src/lib/ai/risk.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type RiskLevel = "low" | "medium" | "high"`
  - `interface RiskAssessment { level: RiskLevel; reasons: string[] }`
  - `scoreAction(toolName: string, category: "read" | "write" | "destructive", args: unknown): RiskAssessment`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/risk.test.ts
import { describe, it, expect } from "vitest";
import { scoreAction } from "./risk";

describe("scoreAction", () => {
  it("reads are low risk", () => {
    expect(scoreAction("pg_list_tables", "read", {}).level).toBe("low");
  });

  it("writes are medium risk", () => {
    const r = scoreAction("redis_set_string", "write", { key: "k" });
    expect(r.level).toBe("medium");
  });

  it("destructive is at least high risk", () => {
    const r = scoreAction("pg_drop_table", "destructive", { table: "orders" });
    expect(r.level).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/destructive/i);
  });

  it("flags a destructive SQL statement with no WHERE clause", () => {
    const r = scoreAction("mysql_run_sql", "destructive", { sql: "DELETE FROM users" });
    expect(r.level).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/where/i);
  });

  it("does not flag a WHERE-scoped statement for the no-filter reason", () => {
    const r = scoreAction("mysql_run_sql", "destructive", { sql: "DELETE FROM users WHERE id = 1" });
    expect(r.reasons.join(" ")).not.toMatch(/no where/i);
  });

  it("flags a wildcard argument", () => {
    const r = scoreAction("blob_delete_objects", "destructive", { prefix: "*" });
    expect(r.reasons.join(" ")).toMatch(/wildcard/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ai/risk.test.ts`
Expected: FAIL — cannot find module `./risk`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ai/risk.ts
export type RiskLevel = "low" | "medium" | "high";

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

const DESTRUCTIVE_NAME = /\b(drop|delete|truncate|remove|empty|purge|reset|destroy)\b/i;

function argStrings(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  return Object.values(args as Record<string, unknown>).filter(
    (v): v is string => typeof v === "string",
  );
}

export function scoreAction(
  toolName: string,
  category: "read" | "write" | "destructive",
  args: unknown,
): RiskAssessment {
  if (category === "read") return { level: "low", reasons: [] };

  if (category === "write") {
    return { level: "medium", reasons: [`Write action (${toolName})`] };
  }

  // destructive
  const reasons: string[] = [`Destructive operation (${toolName})`];
  const strings = argStrings(args);

  // SQL DELETE/UPDATE with no WHERE clause affects every row.
  for (const s of strings) {
    if (/\b(delete|update)\b/i.test(s) && !/\bwhere\b/i.test(s)) {
      reasons.push("SQL statement has no WHERE clause — affects all rows");
      break;
    }
  }
  // Wildcard / match-all arguments.
  if (strings.some((s) => s === "*" || s.includes("*"))) {
    reasons.push("Argument contains a wildcard (*) — may match many objects");
  }

  return { level: "high", reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ai/risk.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/risk.ts src/lib/ai/risk.test.ts
git commit -m "feat(ai): action risk scoring (level + reasons)"
```

---

### Task 2: Make destructive approval non-disableable

**Files:**
- Modify: `src/lib/ai/permissions.ts` (`needsApproval`)
- Modify: `src/lib/ai/permissions.test.ts` (update to new semantics)
- Modify: `src/lib/ai/gate.test.ts` (the autonomous-destructive cases now require approval)

**Interfaces:**
- Consumes: nothing new.
- Produces: `needsApproval(category, policy)` with new semantics: read→false, write→(mode==="confirm"), destructive→true always.

- [ ] **Step 1: Update the failing tests first**

In `src/lib/ai/permissions.test.ts`, find the `needsApproval` cases and make them assert the new semantics (add this block; adjust any existing contradicting case to match):

```ts
import { needsApproval } from "./permissions";

describe("needsApproval — destructive is non-disableable", () => {
  const base = { read: true, write: true, destructive: true } as const;
  it("read never needs approval", () => {
    expect(needsApproval("read", { ...base, mode: "autonomous" })).toBe(false);
    expect(needsApproval("read", { ...base, mode: "confirm" })).toBe(false);
  });
  it("write needs approval only in confirm mode", () => {
    expect(needsApproval("write", { ...base, mode: "confirm" })).toBe(true);
    expect(needsApproval("write", { ...base, mode: "autonomous" })).toBe(false);
  });
  it("destructive ALWAYS needs approval, even autonomous + confirmDestructive:false", () => {
    expect(needsApproval("destructive", { ...base, mode: "confirm" })).toBe(true);
    expect(needsApproval("destructive", { ...base, mode: "autonomous" })).toBe(true);
    expect(needsApproval("destructive", { ...base, mode: "autonomous", confirmDestructive: false })).toBe(true);
  });
});
```

If `permissions.test.ts` has a pre-existing case asserting `needsApproval("destructive", {…confirmDestructive:false})` is `false`, change that expectation to `true` (do not delete the test).

In `src/lib/ai/gate.test.ts`, the case titled "autonomous + destructive + confirmDestructive:false: awaitApproval NOT called, exec IS called" now contradicts the new rule. Update it to assert approval IS requested:

```ts
  it("autonomous + destructive + confirmDestructive:false: still requires approval (non-disableable)", async () => {
    const exec = vi.fn(async () => ({ ok: true }));
    const c = ctx({
      policy: { mode: "autonomous", read: true, write: true, destructive: true, confirmDestructive: false },
      awaitApproval: vi.fn(async () => true),
    });
    const run = wrapExecute(tool("destructive", exec), c);
    await run({}, "tc-6");
    expect(c.awaitApproval).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });
```

Run: `npx vitest run src/lib/ai/permissions.test.ts src/lib/ai/gate.test.ts`
Expected: FAIL — current `needsApproval` returns false for autonomous destructive with `confirmDestructive:false`.

- [ ] **Step 2: Edit `permissions.ts`**

Replace `needsApproval` with:

```ts
export function needsApproval(category: ToolCategory, policy: PermissionPolicy): boolean {
  if (category === "read") return false;
  if (category === "destructive") return true; // non-disableable: destructive always confirms
  return policy.mode === "confirm"; // write
}
```

Leave `confirmDestructive` in the `PermissionPolicy` interface (back-compat) but note with a comment that it no longer affects destructive (which always confirms).

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/permissions.test.ts src/lib/ai/gate.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/permissions.ts src/lib/ai/permissions.test.ts src/lib/ai/gate.test.ts
git commit -m "feat(ai): destructive actions always require approval (non-disableable)"
```

---

### Task 3: Surface risk in the approval prompt

**Files:**
- Modify: `src/app/api/ai/chat/route.ts` (the `awaitApproval` callback)

**Interfaces:**
- Consumes: `scoreAction` (Task 1). The chat route's `awaitApproval` already receives `(toolCallId, tool, args, connection)` where `tool` has `name` and `category`.
- Produces: the `approval-needed` SSE payload gains a `risk: RiskAssessment` field.

- [ ] **Step 1: Edit the chat route**

Add the import: `import { scoreAction } from "@/lib/ai/risk";`

In the `awaitApproval` callback passed to `buildConversationTools`, compute the risk and include it in the emitted `approval-needed` event. The callback currently looks like:

```ts
        awaitApproval: async (toolCallId, tool, args, connection) => {
          sse("approval-needed", { toolCallId, tool: tool.name, category: tool.category, args, connection, sessionId });
          return createPending(sessionId, toolCallId);
        },
```

Change the `sse(...)` line to include risk:

```ts
        awaitApproval: async (toolCallId, tool, args, connection) => {
          const risk = scoreAction(tool.name, tool.category, args);
          sse("approval-needed", { toolCallId, tool: tool.name, category: tool.category, args, connection, sessionId, risk });
          return createPending(sessionId, toolCallId);
        },
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — no errors.
Run: `npm run lint` — no errors.
(There is no unit test for this route; the payload addition is covered by the UI in Task 4 and typechecking. Do not fabricate a route test harness here.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ai/chat/route.ts
git commit -m "feat(ai): include risk assessment in the approval-needed event"
```

---

### Task 4: Risk + typed confirmation in the approval card

**Files:**
- Modify: `src/components/ai/approval-card.tsx`
- Test: `src/components/ai/approval-card.test.tsx`

**Interfaces:**
- Consumes: the `risk` field on the approval payload (Task 3).
- Produces: `PendingApproval` gains `risk?: { level: "low" | "medium" | "high"; reasons: string[] }`. High-risk approvals require typing the connection name (or the tool name when there's no connection) before Approve is enabled.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ai/approval-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalCard, type PendingApproval } from "./approval-card";

function high(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    toolCallId: "t1",
    tool: "pg_drop_table",
    category: "destructive",
    args: { table: "orders" },
    connection: { id: "c1", name: "prod-db" },
    risk: { level: "high", reasons: ["Destructive operation (pg_drop_table)"] },
    ...overrides,
  };
}

describe("ApprovalCard", () => {
  it("low/medium approve immediately", () => {
    const onDecision = vi.fn();
    render(
      <ApprovalCard
        pending={{ toolCallId: "t2", tool: "redis_set_string", category: "write", args: {}, risk: { level: "medium", reasons: [] } }}
        onDecision={onDecision}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onDecision).toHaveBeenCalledWith("t2", "approve");
  });

  it("high-risk Approve is disabled until the connection name is typed", () => {
    const onDecision = vi.fn();
    render(<ApprovalCard pending={high()} onDecision={onDecision} />);
    const approve = screen.getByRole("button", { name: /approve/i });
    expect(approve).toBeDisabled();
    fireEvent.click(approve);
    expect(onDecision).not.toHaveBeenCalled();

    fireEvent.change(screen.getByrole("textbox"), { target: { value: "prod-db" } });
    expect(approve).not.toBeDisabled();
    fireEvent.click(approve);
    expect(onDecision).toHaveBeenCalledWith("t1", "approve");
  });

  it("high-risk shows the risk reasons", () => {
    render(<ApprovalCard pending={high()} onDecision={vi.fn()} />);
    expect(screen.getByText(/destructive operation/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ai/approval-card.test.tsx`
Expected: FAIL — no `risk` field / no typed-confirm input yet.

- [ ] **Step 3: Rewrite `approval-card.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface PendingApproval {
  toolCallId: string;
  tool: string;
  category: "read" | "write" | "destructive";
  args: unknown;
  connection?: { id: string; name: string };
  /** Session the approval belongs to — used to route the decision correctly. */
  sessionId?: string;
  risk?: { level: "low" | "medium" | "high"; reasons: string[] };
}

export function ApprovalCard({
  pending,
  onDecision,
}: {
  pending: PendingApproval;
  onDecision: (toolCallId: string, decision: "approve" | "reject") => void;
}) {
  const destructive = pending.category === "destructive";
  const high = pending.risk?.level === "high";
  // High-risk requires typing the connection name (or tool name) to confirm.
  const confirmTarget = pending.connection?.name ?? pending.tool;
  const [typed, setTyped] = useState("");
  const approveEnabled = !high || typed.trim() === confirmTarget;

  return (
    <div
      className={`rounded-lg border p-3 my-2 ${
        destructive ? "border-destructive/50 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"
      }`}
    >
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
        {destructive ? "Destructive action" : "Action"} needs approval
        {pending.connection ? <> on <b>{pending.connection.name}</b></> : null}
        {pending.risk ? <> · <span className={high ? "text-destructive" : undefined}>{pending.risk.level} risk</span></> : null}
      </div>
      <div className="font-mono text-sm font-medium">{pending.tool}</div>
      <pre className="mt-1 text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto">
        {JSON.stringify(pending.args, null, 2)}
      </pre>
      {pending.risk?.reasons.length ? (
        <ul className="mt-1 text-[11px] text-muted-foreground list-disc pl-4">
          {pending.risk.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {high ? (
        <div className="mt-2">
          <label className="text-[11px] text-muted-foreground">
            Type <b>{confirmTarget}</b> to confirm
          </label>
          <input
            className="mt-1 w-full rounded border border-border/60 bg-background px-2 py-1 text-sm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmTarget}
            aria-label="Type to confirm"
          />
        </div>
      ) : null}
      <div className="flex gap-2 mt-2">
        <Button size="sm" disabled={!approveEnabled} onClick={() => onDecision(pending.toolCallId, "approve")}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecision(pending.toolCallId, "reject")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ai/approval-card.test.tsx`
Expected: PASS (3 tests).

(`assistant-client.tsx` already spreads the `approval-needed` SSE `data` straight into `pending`, so the new `risk` field flows through with no change there. Verify with typecheck in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/approval-card.tsx src/components/ai/approval-card.test.tsx
git commit -m "feat(ai): show risk + require typed confirmation for high-risk approvals"
```

---

### Task 5: Docs + full gate

**Files:**
- Modify: `README.md`, `AGENTS.md` (if it documents the AI approval model)

- [ ] **Step 1: Document the review behavior**

In the README AI assistant section, note: destructive AI actions always require explicit approval (this cannot be turned off, even in autonomous mode); each approval shows a risk level and the reasons; high-risk destructive actions require typing the connection name to confirm.

- [ ] **Step 2: AGENTS.md**

If `AGENTS.md` documents the AI gate/approval, add a one-line note that destructive is non-disableable in `permissions.ts` and approvals carry a `risk` assessment (`src/lib/ai/risk.ts`) with a typed-confirm for high risk. Otherwise skip.

- [ ] **Step 3: Full gate**

Run: `npm run typecheck` → no errors.
Run: `npm run lint` → no errors.
Run: `npm run test` → all green (new risk/approval-card tests + updated permissions/gate tests + existing suite).
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document non-disableable destructive approval + risk review"
```

---

## Self-Review

**Spec coverage** (spec §2, bounded slice):
- Should destructive always require human approval → YES, non-disableable (Task 2). ✅
- Risk scoring before execution → `risk.ts` surfaced in the prompt (Tasks 1, 3, 4). ✅
- Multi-step confirmation → typed confirmation for high-risk (Task 4). ✅
- Preventing prompt injection from bypassing safeguards → injected content can't auto-execute destructive (always pauses for a human) (Task 2). ✅
- Plan→review→execute phase split, dry-run blast-radius, undo, approval expiration → **deferred follow-ups** (see Deviation).

**Placeholder scan:** no TBD/TODO; complete code in every code step. ✅

**Type consistency:** `RiskAssessment { level, reasons }` from `risk.ts` matches the `risk?` shape on `PendingApproval` and the chat-route payload. `scoreAction(toolName, category, args)` used consistently. `needsApproval(category, policy)` signature unchanged. ✅

## Out of scope (follow-ups)
- Full plan→review→execute phase split (model proposes a whole plan; approve-once; then execute) — needs an agent-loop rework.
- Real dry-run blast-radius (per-backend COUNT/affected-rows) — currently a static heuristic on args.
- Undo/rollback and approval expiration.
- Removing the now-vestigial `confirmDestructive` field (kept for back-compat; ignored for destructive).
