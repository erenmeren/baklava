import "server-only";
import type { ProviderId } from "./settings";
import type { CatalogModel } from "./model-catalog";

// Live model discovery. The hardcoded MODEL_CATALOG drifts (models get retired
// or added) and never reflects what a specific account can actually use, which
// surfaces as a 404 not_found_error at chat time. Each provider exposes a
// models endpoint; we call it with the stored key (server-side only) and map
// the result to the same { id, label } shape the UI already renders.

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    // Attach statusCode + responseBody so formatError renders "HTTP <s>: <body>".
    throw Object.assign(new Error("models request failed"), {
      statusCode: res.status,
      responseBody: text,
    });
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function listAnthropic(apiKey: string): Promise<CatalogModel[]> {
  // https://api.anthropic.com/v1/models — every entry is a chat model.
  const json = await fetchJson("https://api.anthropic.com/v1/models?limit=1000", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  const data = (json.data ?? []) as { id: string; display_name?: string }[];
  return data.map((m) => ({ id: m.id, label: m.display_name?.trim() || m.id }));
}

async function listOpenAI(apiKey: string): Promise<CatalogModel[]> {
  // https://api.openai.com/v1/models returns everything (embeddings, tts, …);
  // keep only chat-capable families.
  const json = await fetchJson("https://api.openai.com/v1/models", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const data = (json.data ?? []) as { id: string }[];
  const chat = /^(gpt-|chatgpt|o1|o3|o4)/i;
  return data
    .filter((m) => chat.test(m.id))
    .map((m) => ({ id: m.id, label: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listGoogle(apiKey: string): Promise<CatalogModel[]> {
  // Gemini: filter to models that support generateContent; strip "models/" prefix.
  const json = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`,
    {},
  );
  const models = (json.models ?? []) as {
    name: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }[];
  return models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => {
      const id = m.name.replace(/^models\//, "");
      return { id, label: m.displayName?.trim() || id };
    });
}

export async function listModels(
  provider: ProviderId,
  apiKey: string,
): Promise<CatalogModel[]> {
  if (!apiKey?.trim()) throw new Error("Missing API key for provider " + provider);
  switch (provider) {
    case "anthropic":
      return listAnthropic(apiKey);
    case "openai":
      return listOpenAI(apiKey);
    case "google":
      return listGoogle(apiKey);
    default:
      throw new Error("Unknown provider: " + provider);
  }
}
