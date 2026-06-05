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

export function labelFor(provider: ProviderId, id: string): string {
  return MODEL_CATALOG[provider]?.find((m) => m.id === id)?.label ?? id;
}
