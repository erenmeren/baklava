import { z } from "zod";
import { baseUrlSchema, profileSchema, requestStepSchema, thresholdsSchema } from "./schema";
import { metricKey } from "./script-gen";

// UI-facing auth model: holds LITERAL secret values (stored at rest in a 0600
// file, redacted on API responses — not encrypted, matching connections.json).
// Translated to the engine's env-name auth at run time by toEngineConfig().
export const savedAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({ type: z.literal("basic"), username: z.string(), password: z.string() }),
  z.object({ type: z.literal("apiKey"), header: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal("customHeaders"), headers: z.record(z.string(), z.string()) }),
]);

export const savedLoadTestConfigSchema = z
  .object({
    target: z.object({
      baseUrl: baseUrlSchema,
      headers: z.record(z.string(), z.string()).optional(),
    }),
    requests: z.array(requestStepSchema).min(1),
    auth: savedAuthSchema.default({ type: "none" }),
    profile: profileSchema,
    thresholds: thresholdsSchema,
  })
  // Mirrors the engine's loadTestConfigSchema refine: per-request metric keys
  // must be unique or the generated k6 script declares duplicate consts.
  .superRefine((cfg, ctx) => {
    const seen = new Map<string, number>();
    cfg.requests.forEach((r, i) => {
      const key = metricKey(r.name);
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["requests", i, "name"],
          message: `Request name "${r.name}" collides with "${cfg.requests[seen.get(key)!].name}" (both map to metric "${key}"). Use distinct names.`,
        });
      } else {
        seen.set(key, i);
      }
    });
  });

export type SavedAuth = z.infer<typeof savedAuthSchema>;
export type SavedLoadTestConfig = z.infer<typeof savedLoadTestConfigSchema>;
