# AI Assistant — Multi-Connection Chat (Design Spec)

- **Status:** Approved (brainstorm) — ready for implementation planning
- **Date:** 2026-06-05
- **Builds on:** `docs/superpowers/specs/2026-06-04-ai-assistant-design.md` (Phase 1, shipped)
- **Supersedes:** the Phase 1 single-connection panel + select-box picker.

## Summary

Evolve the AI assistant from a single-connection slide-in panel into a
**dedicated full-page global chat** (`/assistant`) where a conversation can use
**multiple connections at once, working together**. Connections are added to a
per-conversation **working set** via an inline **"/" picker** (no select box).
Conversations are **persisted and resumable**.

Phase 1's security-critical gate (`src/lib/ai/gate.ts`) and the per-connection
tool builders (`pgTools`/`dockerTools`) are **extended, not rewritten** — a new
addressing layer sits on top, so each per-connection gate keeps enforcing that
connection's own policy.

## Goals

- One global chat; pick connections inline with "/", shown as removable chips.
- A conversation can hold several connections of different techs; the AI targets
  the right one per action and can use several in a single answer.
- Conversations persist (a sidebar of past chats you can resume).
- Multi-turn keeps tool-call context (fixes the Phase 1 gap).
- Per-connection permissions/approvals unchanged and bounded.

## Non-goals (this round)

- Autonomous-mode UI toggles (still API/policy-route only).
- Techs beyond Postgres + Docker (gated by existing `AI_SUPPORTED_TECHS`).
- Model-generated conversation titles, conversation search/sharing, remote sync.
- Keeping the slide-in panel — it is **retired**; the ✨ header trigger now
  navigates to `/assistant`.

---

## UX — the `/assistant` page

```
┌───────────────┬───────────────────────────────────────────────┐
│ Conversations │  Working set:  [⬡ prod ·rw ×] [🐳 local ·ro ×]  │
│ ───────────── │  ───────────────────────────────────────────── │
│ ▸ Revenue Q3  │  you: compare error counts in local's api      │
│ ▸ DB cleanup  │       container with the orders table in prod   │
│ ▸ (new chat)  │  ai:  reading logs…  [docker_read_logs ·local] │
│               │       querying…       [pg_run_sql ·prod]        │
│               │       → here's what I found…                    │
│               │  ───────────────────────────────────────────── │
│               │  > /  ◄ type "/" → menu of AI-capable conns     │
└───────────────┴───────────────────────────────────────────────┘
```

- **Left rail:** saved conversations + "New chat". Selecting one loads its working
  set + transcript.
- **Working-set chips:** each chip shows the connection's policy mode (e.g. `·ro`,
  `·rw`); `×` removes it; clicking the chip opens a small **policy popover**
  (read/write/destructive + confirm/autonomous) backed by the existing policy
  route — inline tightening/loosening without leaving the chat.
- **"/" picker:** typing `/` (at a token boundary) opens a `cmdk` popup listing
  **AI-supported connections not already in the set**, filterable by name. Picking
  one adds a chip and removes the `/`. Each row: tech icon + name + tech + status.
- **Header trigger:** `assistant-trigger.tsx` navigates to `/assistant` (no panel).

**Hard rule (security + clarity):** the AI can act ONLY on connections in the
working set. "/" is the sole way to grant access; naming a connection in prose
grants nothing.

---

## Architecture

### Tool addressing — `src/lib/ai/conversation-tools.ts` (NEW)

Builds the agent's tool list for a conversation's working set without changing
the gate or the single-connection builders:

1. For each connection in the set, resolve its record + policy server-side, then
   call the existing single-connection builder via the registry to get that
   connection's **already-gated** executes (each wrapped by `wrapExecute` with
   *that connection's* policy, connectionId, audit).
2. **Merge same-named tools** across connections into ONE tool whose `inputSchema`
   gains a `connection` field: a **zod enum constrained to the connections of that
   tool's tech in the set** (e.g. `pg_run_sql.connection ∈ {"prod","staging"}`).
   The display handle is the connection name; the server maps handle → id within
   the set (append a short id suffix if two names collide).
3. The merged tool's `execute({ connection, ...rest }, toolCallId)` dispatches
   `connection` → that connection's gated execute with `rest`.

Result: `pg_drop_table({connection:"prod", …})` runs through prod's existing gate
(prod's policy → approval → audit). **`gate.ts` is unchanged**; security is
preserved per connection. With one connection of a tech, the enum has a single
value so the model cannot misfire. With zero connections, the tool set is empty
and the system prompt instructs the model to ask the user to add one via "/".

The system prompt lists the working set (name + tech) so the model knows its
options; the per-tech enum is the hard constraint.

### Approval + events carry the connection

`approval-needed` and `tool-call`/`tool-result` SSE events include the target
connection (id + name) so the approval card reads "drop table on **prod**" and
tool chips show `[tool ·connection]`. This is achieved by the per-connection
context the addressing layer already holds (`GateContext.connectionId`); the
route's `awaitApproval` is extended to receive and forward the connection name.

### Conversation persistence — `src/lib/ai/conversation-store.ts` (NEW)

`~/.baklava/ai-conversations/<id>.json` (mode 0600), globalThis + disk mirror like
the other stores:
```ts
interface Conversation {
  id: string;
  title: string;            // derived from first user message
  connectionIds: string[];  // the working set
  messages: ModelMessage[]; // FULL history incl. tool-call/tool-result steps
  createdAt: number;
  updatedAt: number;
}
```
- `GET /api/ai/conversations` (list, lightweight: id/title/updatedAt),
  `POST /api/ai/conversations` (create), `GET|PUT|DELETE /api/ai/conversations/[id]`.
- On load, connectionIds whose connection no longer exists are dropped from the
  set (and the chip list).
- Title auto-derived from the first user message (truncated).

### Multi-turn history (required fix)

The conversation stores full model messages **including tool steps**. The chat
route receives the working set + the prior messages and replays them so follow-
ups keep context ("now drop that table we found"). The route appends the new
user message, the assistant's tool-call/result steps, and the final assistant
message back into the conversation and persists.

### Chat route changes — `src/app/api/ai/chat/route.ts` (MODIFIED)

Request becomes:
```ts
{ conversationId: string; sessionId: string;
  connections: { id: string; tech: TechId }[];   // the working set
  messages: ModelMessage[] }                       // full prior history
```
- Validate each connection: exists, tech matches, `isAiSupported`. Drop invalid
  ones; if the set is empty, still allow chat (no tools).
- Build tools via `buildConversationTools(resolvedConns, gateCtx)`.
- One provider/model (active provider) as today; `stepCap` from settings.
- SSE pattern unchanged (heartbeat, abort cleanup, event/data frames). New events
  carry `connection`. Persist the updated conversation on `done`.

---

## Components

```
src/app/assistant/page.tsx              # RSC shell
src/app/assistant/assistant-client.tsx  # owns conversation + working set + SSE client
src/components/ai/working-set.tsx       # chips + policy popover
src/components/ai/slash-picker.tsx      # "/" cmdk popup over AI-supported conns
src/components/ai/conversation-list.tsx # left rail (list/new/delete)
src/components/ai/message-list.tsx      # EXTENDED: tool chips show ·connection
src/components/ai/approval-card.tsx     # EXTENDED: shows target connection
src/components/ai/ai-settings-dialog.tsx# reused as-is
src/components/ai/assistant-trigger.tsx # MODIFIED: navigates to /assistant
# retired: src/components/ai/assistant-panel.tsx, connection-picker.tsx
```

`AI_SUPPORTED_TECHS`/`isAiSupported` (client-safe `supported.ts`) gate which
connections appear in the "/" picker.

---

## Security considerations

- **Transcripts now contain data read from prod** (table cells, container logs).
  Stored locally at `~/.baklava/ai-conversations/*.json` mode 0600 — same trust
  model as `connections.json`. No remote storage. Document this.
- **Blast radius is bounded per connection.** A conversation may hold several
  connections, but every action is still gated by *its own* connection's policy
  + approval. A read-only prod cannot be written from a conversation that also
  holds an autonomous dev box. The merged tool's `connection` enum cannot name a
  connection outside the working set.
- **Grant model:** only "/"-added connections are reachable; prose names grant
  nothing (enforced by the enum + server-side set resolution).
- Carried over from Phase 1: read-only `pg_run_sql` blocks `;`; provider keys and
  connection secrets never reach the client; per-tool audit log; step cap.

---

## Testing strategy

- **Unit (`conversation-tools.ts`):** merging same-named tools across 2 Postgres
  connections produces one tool with a 2-value `connection` enum; dispatch routes
  to the correct per-connection gated execute (spy); a connection NOT in the set
  is not addressable; mixed-tech set yields pg_* and docker_* tools each enum-
  scoped to their tech's members; empty set → `[]`.
- **Unit (`conversation-store.ts`):** create/get/update/delete round-trips to a
  tmpdir; list returns lightweight rows; loading drops dangling connectionIds.
- **Unit:** the gate is reused unchanged — its existing tests still pass.
- **Route/manual:** SSE events carry connection; approval card labels connection;
  multi-turn replay keeps tool context; deleting a connection drops it from open
  conversations.

## Open questions / deferred

- Two connections with identical names: disambiguate the handle with a short id
  suffix (decide exact format in planning).
- Conversation title regeneration / rename — deferred (auto-from-first-message
  only for now).
- Whether the policy popover edits should re-fetch tools mid-conversation (yes:
  the next message rebuilds tools from the current set + policies).
