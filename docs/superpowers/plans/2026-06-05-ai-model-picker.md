# AI Model Picker (Cursor-style) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text model field with a curated, brand-grouped, key-gated model picker (Cursor-style) in the `/assistant` input bar that sets the global active model.

**Architecture:** A client-safe `MODEL_CATALOG` constant drives both a new inline `ModelPicker` dropdown and the existing settings dialog's model field. Selecting a model POSTs `{provider, model, activeProvider}` to the **existing** `/api/ai/settings` route — no backend changes.

**Tech Stack:** React 19, base-ui `dropdown-menu`, TypeScript, Vitest. Reuses `src/lib/ai/settings.ts` (`ProviderId`, `/api/ai/settings`).

**Spec:** `docs/superpowers/specs/2026-06-05-ai-model-picker-design.md`

**Branch:** continue on `fix/ai-chat-followups` (already checked out).

---

## File Structure

- **Create:** `src/lib/ai/model-catalog.ts` (client-safe catalog + `labelFor`), `src/lib/ai/model-catalog.test.ts`, `src/components/ai/model-picker.tsx`.
- **Modify:** `src/components/ai/ai-settings-dialog.tsx` (model field → catalog `<select>`), `src/app/assistant/assistant-client.tsx` (mount the picker).

---

## Task 1: Model catalog

**Files:** Create `src/lib/ai/model-catalog.ts`; Test `src/lib/ai/model-catalog.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/model-catalog.test.ts
import { describe, it, expect } from "vitest";
import { MODEL_CATALOG, PROVIDER_LABELS, labelFor } from "./model-catalog";

describe("model catalog", () => {
  it("covers exactly anthropic/openai/google with non-empty ids + labels", () => {
    const providers = Object.keys(MODEL_CATALOG).sort();
    expect(providers).toEqual(["anthropic", "google", "openai"]);
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual(["anthropic", "google", "openai"]);
    for (const list of Object.values(MODEL_CATALOG)) {
      expect(list.length).toBeGreaterThan(0);
      for (const m of list) {
        expect(m.id.trim().length).toBeGreaterThan(0);
        expect(m.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("labelFor returns the label for a known id, raw id otherwise", () => {
    expect(labelFor("anthropic", "claude-sonnet-4-6")).toBe("Claude Sonnet 4.6");
    expect(labelFor("anthropic", "some-future-id")).toBe("some-future-id");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/model-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/ai/model-catalog.ts
import type { ProviderId } from "./settings"; // type-only — keeps this client-safe

export interface CatalogModel {
  id: string;
  label: string;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  google: "Google (Gemini)",
};

// NOTE: anthropic ids are correct; openai/google are best-guess defaults — verify
// against each provider's current lineup. This is the single place to update.
export const MODEL_CATALOG: Record<ProviderId, CatalogModel[]> = {
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
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

/** Human label for a model id; falls back to the raw id when not in the catalog. */
export function labelFor(provider: ProviderId, id: string): string {
  return MODEL_CATALOG[provider]?.find((m) => m.id === id)?.label ?? id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/ai/model-catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run `npm run typecheck`** — expect PASS. Commit:
```bash
git add src/lib/ai/model-catalog.ts src/lib/ai/model-catalog.test.ts
git commit -m "feat(ai): curated model catalog (brand-grouped)"
```

---

## Task 2: Settings dialog → catalog dropdown

**Files:** Modify `src/components/ai/ai-settings-dialog.tsx` (replace entirely).

The current dialog has a free-text model `<Input>`. Replace it with a `<select>` driven by `MODEL_CATALOG[provider]`, and derive the provider `<option>`s from `PROVIDER_LABELS` (DRY). When the provider changes, reset the model to that provider's first catalog id.

- [ ] **Step 1: Replace the file with:**

```tsx
// src/components/ai/ai-settings-dialog.tsx
"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { ProviderId } from "@/lib/ai/settings";
import { MODEL_CATALOG, PROVIDER_LABELS } from "@/lib/ai/model-catalog";

export function AiSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(MODEL_CATALOG.anthropic[0].id);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/ai/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const active = d.settings?.activeProvider as ProviderId | null;
        if (active) {
          setProvider(active);
          setModel(d.settings.providers?.[active]?.model ?? MODEL_CATALOG[active][0].id);
          setHasKey(Boolean(d.settings.providers?.[active]?.apiKey));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onProviderChange = (p: ProviderId) => {
    setProvider(p);
    // Reset model to the new provider's first catalog entry if the current one
    // isn't valid for it.
    if (!MODEL_CATALOG[p].some((m) => m.id === model)) setModel(MODEL_CATALOG[p][0].id);
    setApiKey("");
  };

  const save = async () => {
    const res = await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey, model, activeProvider: provider }),
    });
    if (res.ok) {
      toast.success("AI settings saved");
      onOpenChange(false);
    } else {
      toast.error("Could not save settings");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as ProviderId)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>API key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? "(unchanged — leave blank to keep)" : "sk-…"}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {MODEL_CATALOG[provider].map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint` — expect PASS.
Run: `npm test` — existing tests still pass (no test imports this dialog).

- [ ] **Step 3: Commit**
```bash
git add src/components/ai/ai-settings-dialog.tsx
git commit -m "feat(ai): settings dialog model field uses the catalog"
```

---

## Task 3: Inline model picker + mount

**Files:** Create `src/components/ai/model-picker.tsx`; Modify `src/app/assistant/assistant-client.tsx`.

- [ ] **Step 1: Create the picker**

base-ui `DropdownMenuItem` uses `onClick` (confirmed by existing usage in `src/components/blob/bucket-sidebar.tsx`). The brand headers + separators use plain styled divs (no dependency on a `DropdownMenuLabel` export).

```tsx
// src/components/ai/model-picker.tsx
"use client";
import { useCallback, useState } from "react";
import { ChevronDown, Check, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/lib/ai/settings";
import { MODEL_CATALOG, PROVIDER_LABELS, labelFor } from "@/lib/ai/model-catalog";

interface ActiveModel {
  provider: ProviderId | null;
  model: string;
}

export function ModelPicker({ onConfigure }: { onConfigure: () => void }) {
  const [active, setActive] = useState<ActiveModel>({ provider: null, model: "" });
  const [configured, setConfigured] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/ai/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const s = d.settings ?? {};
        const ap = (s.activeProvider ?? null) as ProviderId | null;
        setActive({ provider: ap, model: ap ? s.providers?.[ap]?.model ?? "" : "" });
        const cfg: Partial<Record<ProviderId, boolean>> = {};
        for (const p of Object.keys(MODEL_CATALOG) as ProviderId[]) {
          cfg[p] = Boolean(s.providers?.[p]?.apiKey);
        }
        setConfigured(cfg);
      })
      .catch(() => {});
  }, []);

  const pick = useCallback(async (provider: ProviderId, model: string) => {
    setActive({ provider, model });
    setOpen(false);
    await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, model, activeProvider: provider }),
    }).catch(() => {});
  }, []);

  const label = active.provider ? labelFor(active.provider, active.model) : "Pick a model";

  return (
    <DropdownMenu open={open} onOpenChange={(v) => { setOpen(v); if (v) refresh(); }}>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 h-7 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors outline-none">
        <Sparkles className="size-3" />
        <span className="max-w-[180px] truncate">{label}</span>
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-[240px] p-1">
        {(Object.keys(MODEL_CATALOG) as ProviderId[]).map((provider, i) => (
          <div key={provider}>
            {i > 0 ? <div className="my-1 h-px bg-border/60" aria-hidden /> : null}
            <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {PROVIDER_LABELS[provider]}
            </div>
            {configured[provider] ? (
              MODEL_CATALOG[provider].map((m) => {
                const isActive = active.provider === provider && active.model === m.id;
                return (
                  <DropdownMenuItem key={m.id} onClick={() => pick(provider, m.id)} className="gap-2">
                    <Check className={cn("size-3.5", isActive ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{m.label}</span>
                  </DropdownMenuItem>
                );
              })
            ) : (
              <DropdownMenuItem
                onClick={() => { setOpen(false); onConfigure(); }}
                className="text-muted-foreground italic"
              >
                <span className="flex-1">Add {PROVIDER_LABELS[provider]} API key…</span>
              </DropdownMenuItem>
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Mount in the input bar of `src/app/assistant/assistant-client.tsx`**

Add the import at the top with the other component imports:
```tsx
import { ModelPicker } from "@/components/ai/model-picker";
```
Then, in the input-bar `<div className="relative border-t border-border/60 p-3">`, AFTER the inner `<div className="flex gap-2"> … </div>` that holds the `<input>` and send `<button>`, add a row below it:
```tsx
          <div className="mt-1.5">
            <ModelPicker onConfigure={() => setSettingsOpen(true)} />
          </div>
```
Read the file first to place it precisely inside the input bar (after the input/send flex row, before the closing `</div>` of the input bar). Change nothing else.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint` — expect PASS.
Run: `npm test` — all pass.
Run: `npm run build` — expect "Compiled successfully"; `/assistant` listed.

- [ ] **Step 4: Commit**
```bash
git add src/components/ai/model-picker.tsx src/app/assistant/assistant-client.tsx
git commit -m "feat(ai): Cursor-style inline model picker in the chat input bar"
```

---

## Task 4: Manual verification

**Files:** none.

- [ ] **Step 1: Automated gate** — `npm test && npm run typecheck && npm run lint && npm run build` all green.
- [ ] **Step 2:** `npm run dev` → `/assistant`. The input bar shows a model pill (e.g. `✦ Claude Sonnet 4.6 ▾` if Anthropic is configured, else "Pick a model").
- [ ] **Step 3:** Open the pill → models grouped by brand. Configured brand's models are selectable; pick one → the pill label updates and the next message uses it. Confirm via the AI Settings dialog that the active model changed.
- [ ] **Step 4:** A brand with **no key** shows "Add <Brand> API key…" instead of models; clicking it opens AI Settings. Add a key there, save, reopen the pill → that brand's models are now selectable.
- [ ] **Step 5:** In AI Settings, the **Model** field is now a dropdown of catalog models for the chosen provider (no free text), and switching provider repopulates it.

---

## Self-Review (completed during authoring)

- **Spec coverage:** catalog constant (Task 1) · Cursor-style inline picker in input bar (Task 3) · key-gating with "Add key" → settings (Task 3) · settings dialog uses catalog (Task 2) · reuses existing `/api/ai/settings`, no backend change · `labelFor` fallback for unknown ids (Task 1 + picker). All spec sections map to a task.
- **Placeholder scan:** every code step is complete; the OpenAI/Google ids are intentional editable defaults flagged in the catalog comment.
- **Type consistency:** `ProviderId` (type-only import) used in `model-catalog.ts`, `ai-settings-dialog.tsx`, `model-picker.tsx`; `MODEL_CATALOG`/`PROVIDER_LABELS`/`labelFor`/`CatalogModel` defined in Task 1 and consumed unchanged in Tasks 2–3; `ModelPicker` prop `onConfigure: () => void` matches the mount call. (Note: simplified the spec's `onConfigure(provider)` to `onConfigure()` — the settings dialog defaults to the active provider; preselecting a brand is an optional later nicety.)
- **base-ui note:** `DropdownMenuItem onClick` confirmed against `bucket-sidebar.tsx`; brand headers/separators use plain divs to avoid relying on specific menu sub-exports.
