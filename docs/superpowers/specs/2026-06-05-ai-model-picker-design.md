# AI Model Picker (Cursor-style) — Design Spec

- **Status:** Approved (brainstorm) — ready for implementation planning
- **Date:** 2026-06-05
- **Branch:** built on `fix/ai-chat-followups` (still open), finished/merged together.
- **Builds on:** the multi-connection AI chat (`/assistant`).

## Summary

Replace the free-text model field with a **curated, brand-grouped model picker**.
A Cursor-style dropdown in the chat input bar lets the user pick the **global
active model**; the choice persists in the existing AI settings and every chat
uses it. Models are presented per brand from an editable catalog; a brand is
only selectable once its API key is saved.

## Goals

- Pick the active model from a curated list (no typing model ids).
- See which models are available per brand (Anthropic / OpenAI / Google).
- Cursor-style inline picker in the chat input bar; persists globally.
- Don't let the user pick a brand they haven't configured (key-gated).

## Non-goals

- Per-conversation model override (global active model only).
- Auto-discovering models from provider APIs (static editable catalog).
- New provider integrations (still anthropic / openai / google via the AI SDK).

## Data model — reuse existing settings

The "active model" already exists as `(activeProvider, providers[activeProvider].model)`
in `src/lib/ai/settings.ts` (`AiSettings`). Selecting a model just sets both, and
the **existing** `POST /api/ai/settings` already accepts `{ provider, model,
activeProvider }` and does `saveProvider` + `setActiveProvider` (blank apiKey =
keep). **No backend changes are required** beyond the catalog constant.

## Model catalog — `src/lib/ai/model-catalog.ts` (NEW, client-safe)

```ts
import type { ProviderId } from "./settings"; // type-only import (client-safe)

export interface CatalogModel { id: string; label: string }

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  google: "Google (Gemini)",
};

export const MODEL_CATALOG: Record<ProviderId, CatalogModel[]> = {
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  // NOTE: openai/google ids are best-guess defaults — verify against each
  // provider's current lineup; this constant is the single place to update.
  openai: [
    { id: "gpt-5.1", label: "GPT-5.1" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
  ],
  google: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
};

/** Human label for an id, falling back to the raw id if not in the catalog. */
export function labelFor(provider: ProviderId, id: string): string {
  return MODEL_CATALOG[provider]?.find((m) => m.id === id)?.label ?? id;
}
```

Importing only the `ProviderId` *type* keeps `model-catalog.ts` client-safe (no
server-only `settings.ts` runtime code pulled into the bundle).

## Inline picker — `src/components/ai/model-picker.tsx` (NEW)

- A compact dropdown button in the chat input bar (bottom-left), label =
  `labelFor(activeProvider, activeModel)` with a chevron; shows "Pick a model"
  when nothing is configured.
- On open, fetches `GET /api/ai/settings` (redacted) to know the active model and
  **which brands have a key** (a provider entry with a non-empty masked `apiKey`).
- Lists models grouped by brand (`PROVIDER_LABELS` headers, `MODEL_CATALOG` items).
- A configured brand's items are selectable; selecting one POSTs
  `{ provider, model, activeProvider: provider }` to `/api/ai/settings`, updates
  the button label, and closes.
- An **unconfigured brand**'s items are disabled; the group shows an "Add key"
  action that calls a passed `onConfigure(provider)` callback → opens the AI
  Settings dialog (the parent owns `settingsOpen`).
- Built with the existing `@/components/ui/dropdown-menu` (base-ui), matching the
  app's other menus.

Mounted in `src/app/assistant/assistant-client.tsx` in the input bar, left of the
text input; the client passes `onConfigure` that opens the settings dialog.

## Settings dialog consistency — `src/components/ai/ai-settings-dialog.tsx` (MODIFY)

The free-text **model** field becomes a `<select>` populated from
`MODEL_CATALOG[provider]` (switching provider repopulates it and defaults to the
first model). Keys remain as-is. This keeps the two surfaces in agreement.

## Security / behavior notes

- Carried over: provider keys never leave the server; `/api/ai/settings` GET is
  redacted; the picker only learns *whether* a key exists (masked), not its value.
- If the user somehow has an active model whose id isn't in the catalog (e.g. a
  prior free-text value), `labelFor` falls back to showing the raw id — no crash.

## Testing

- Unit (`model-catalog.test.ts`): every catalog id + label is a non-empty string;
  `MODEL_CATALOG` and `PROVIDER_LABELS` cover exactly the `ProviderId` union;
  `labelFor` returns the label for a known id and the raw id for an unknown one.
- Picker + dialog: verified by `npm run build` + the live check (selecting a model
  switches the active model; an unconfigured brand is gated to "Add key").

## Open item

- Confirm/adjust the **OpenAI and Google model ids** in `MODEL_CATALOG`
  (Anthropic ids are correct). Defaults ship as above; updating is a one-line edit.
