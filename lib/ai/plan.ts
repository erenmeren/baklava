import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { BaklavaException, makeError } from "../errors";
import { getAnthropicApiKey } from "../config";
import { buildPrompt, type BuildPromptInput } from "./prompt";

export interface RawPlan {
  plan_english: string;
  sources: { connection: string; table: string }[];
  sql: string;
}

/**
 * Pluggable text generator. Production wires this to the Vercel ai SDK with
 * Anthropic; tests pass a stub that returns a canned response.
 */
export type PlanGenerator = (args: { system: string; user: string }) => Promise<string>;

/** Default model. Sonnet 4.6 is the cost-effective choice for NL→SQL. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

export function defaultGenerator(model: string = DEFAULT_MODEL): PlanGenerator {
  return async ({ system, user }) => {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      throw new BaklavaException(
        makeError({
          code: "E_AI_KEY_MISSING",
          what: "Anthropic API key is not configured.",
          why: "baklava uses Claude to translate your question into a query plan, and no key was found in ANTHROPIC_API_KEY or in ~/.baklava/config.json.",
          fix: "Get a key from https://console.anthropic.com/, then either export ANTHROPIC_API_KEY or paste it into Settings.",
        })
      );
    }
    const anthropic = createAnthropic({ apiKey });
    try {
      const result = await generateText({
        model: anthropic(model),
        system,
        prompt: user,
      });
      return result.text;
    } catch (err) {
      throw classifyAiError(err);
    }
  };
}

function classifyAiError(err: unknown): BaklavaException {
  const msg = (err as Error).message ?? String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return new BaklavaException(
      makeError({
        code: "E_AI_RATE_LIMIT",
        what: "Anthropic rate-limited the request.",
        why: msg,
        fix: "Wait a moment and retry. If this persists, check your usage at https://console.anthropic.com/.",
      })
    );
  }
  if (lower.includes("quota") || lower.includes("credit") || lower.includes("billing")) {
    return new BaklavaException(
      makeError({
        code: "E_AI_QUOTA_EXCEEDED",
        what: "Anthropic quota exceeded or billing issue.",
        why: msg,
        fix: "Add credits or update billing at https://console.anthropic.com/.",
      })
    );
  }
  if (
    lower.includes("invalid") &&
    (lower.includes("api key") || lower.includes("auth") || lower.includes("401"))
  ) {
    return new BaklavaException(
      makeError({
        code: "E_AI_KEY_INVALID",
        what: "Anthropic rejected the API key.",
        why: msg,
        fix: "Generate a new key at https://console.anthropic.com/ and update ANTHROPIC_API_KEY or Settings.",
      })
    );
  }
  if (lower.includes("timeout")) {
    return new BaklavaException(
      makeError({
        code: "E_AI_TIMEOUT",
        what: "Anthropic request timed out.",
        why: msg,
        fix: "Retry. If this happens often, your network may be slow or Anthropic may be degraded.",
      })
    );
  }
  return new BaklavaException(
    makeError({
      code: "E_AI_INVALID_PLAN",
      what: "Anthropic call failed.",
      why: msg,
      fix: "Retry, or check the Anthropic console for service status.",
      raw: err,
    })
  );
}

const FENCE_RE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(FENCE_RE);
  if (match?.[1]) return match[1].trim();
  return trimmed;
}

function parsePlan(raw: string): RawPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new BaklavaException(
      makeError({
        code: "E_AI_INVALID_PLAN",
        what: "The AI did not return valid JSON.",
        why: `JSON.parse failed: ${(err as Error).message}`,
        fix: "Retry. If this keeps happening the prompt may need tightening.",
        raw: { rawResponse: raw.slice(0, 500) },
      })
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BaklavaException(
      makeError({
        code: "E_AI_INVALID_PLAN",
        what: "The AI returned a non-object response.",
        why: "Plan must be a JSON object with plan_english, sources, sql.",
        fix: "Retry. The model may have ignored the format instructions.",
        raw: { rawResponse: raw.slice(0, 500) },
      })
    );
  }
  const obj = parsed as Record<string, unknown>;
  const planEnglish = obj.plan_english;
  const sources = obj.sources;
  const sql = obj.sql;

  if (typeof planEnglish !== "string" || planEnglish.length === 0) {
    throw shapeError("plan_english must be a non-empty string", raw);
  }
  if (typeof sql !== "string" || sql.length === 0) {
    throw shapeError("sql must be a non-empty string", raw);
  }
  if (!Array.isArray(sources)) {
    throw shapeError("sources must be an array", raw);
  }
  const cleanSources: { connection: string; table: string }[] = [];
  for (const s of sources) {
    if (!s || typeof s !== "object") {
      throw shapeError("each source must be an object", raw);
    }
    const so = s as Record<string, unknown>;
    if (typeof so.connection !== "string" || typeof so.table !== "string") {
      throw shapeError("each source needs string connection + table fields", raw);
    }
    cleanSources.push({ connection: so.connection, table: so.table });
  }
  return { plan_english: planEnglish, sources: cleanSources, sql };
}

function shapeError(reason: string, raw: string): BaklavaException {
  return new BaklavaException(
    makeError({
      code: "E_AI_INVALID_PLAN",
      what: "AI plan does not match the required shape.",
      why: reason,
      fix: "Retry. The validator's auto-retry will re-prompt the AI with this reason.",
      raw: { rawResponse: raw.slice(0, 500) },
    })
  );
}

export interface GeneratePlanInput extends BuildPromptInput {
  generator?: PlanGenerator;
}

export async function generatePlan(input: GeneratePlanInput): Promise<RawPlan> {
  const generator = input.generator ?? defaultGenerator();
  const built = buildPrompt(input);
  const raw = await generator({ system: built.system, user: built.user });
  return parsePlan(raw);
}
