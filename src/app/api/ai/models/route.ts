import "server-only";
import { NextResponse } from "next/server";
import { formatError } from "@/lib/errors";
import { getSettings, type ProviderId } from "@/lib/ai/settings";
import { listModels } from "@/lib/ai/list-models";
import { MODEL_CATALOG } from "@/lib/ai/model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live model list for a provider. Uses the SERVER-stored API key (the client
// only ever holds the redacted key) and returns just model ids/labels — the key
// never leaves the server. Falls back to the static catalog if there's no key
// or the provider call fails, so the picker always has something to show.
export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") as ProviderId | null;
  // Own-property check, not `in` (which walks the prototype chain and would let
  // ?provider=constructor / __proto__ slip past).
  if (!provider || !Object.prototype.hasOwnProperty.call(MODEL_CATALOG, provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const apiKey = getSettings().providers[provider]?.apiKey;
  if (!apiKey) {
    return NextResponse.json({
      models: MODEL_CATALOG[provider],
      source: "fallback",
      error: "No API key saved for this provider yet.",
    });
  }

  try {
    const models = await listModels(provider, apiKey);
    // Defensive: an empty live list is less useful than the curated fallback.
    if (!models.length) {
      return NextResponse.json({ models: MODEL_CATALOG[provider], source: "fallback" });
    }
    return NextResponse.json({ models, source: "live" });
  } catch (err) {
    return NextResponse.json({
      models: MODEL_CATALOG[provider],
      source: "fallback",
      error: formatError(err),
    });
  }
}
