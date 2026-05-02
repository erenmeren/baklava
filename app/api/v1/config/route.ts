import { ok, secured } from "../../../../lib/api";
import { BaklavaException, makeError } from "../../../../lib/errors";
import { loadConfig, saveConfig, CURRENT_SCHEMA_VERSION } from "../../../../lib/config";

export const GET = secured(async () => {
  const cfg = loadConfig();
  return ok({
    schema_version: cfg.schema_version,
    hasAiKey: typeof cfg.anthropic_api_key === "string" && cfg.anthropic_api_key.length > 0,
  });
});

interface SetKeyBody {
  anthropic_api_key?: unknown;
}

export const POST = secured(async (req) => {
  const body = (await req.json().catch(() => ({}))) as SetKeyBody;
  const key = body.anthropic_api_key;
  if (typeof key !== "string" || !key.trim()) {
    throw new BaklavaException(
      makeError({
        code: "E_INTERNAL",
        what: "Body must include { anthropic_api_key: string }.",
        why: "The settings page sends the key as a non-empty string.",
        fix: "POST {\"anthropic_api_key\":\"sk-ant-...\"}.",
      })
    );
  }
  const cfg = loadConfig();
  cfg.schema_version = CURRENT_SCHEMA_VERSION;
  cfg.anthropic_api_key = key.trim();
  saveConfig(cfg);
  return ok({ saved: true });
});

export const DELETE = secured(async () => {
  const cfg = loadConfig();
  cfg.schema_version = CURRENT_SCHEMA_VERSION;
  delete cfg.anthropic_api_key;
  saveConfig(cfg);
  return ok({ deleted: true });
});
