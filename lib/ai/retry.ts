import { BaklavaException, makeError } from "../errors.js";
import { generatePlan, type GeneratePlanInput, type RawPlan } from "./plan.js";
import type { ValidationResult } from "./validate.js";

/**
 * Strategy: ask the AI for a plan. Validate it. If the validator rejects, ask
 * once more with the failure reason fed back into the prompt. If THAT also
 * fails, throw — the human edits the SQL by hand or rephrases.
 *
 * One retry is the right number for v0.1 because the validator's failure
 * messages are precise (e.g., "table foo not in declared sources"), so the
 * model usually fixes the issue immediately. More than one retry burns tokens
 * for diminishing returns; zero retries punishes users for occasional misses.
 */
export interface PlanWithRetryInput extends GeneratePlanInput {
  /** Validate a candidate plan. Return ok=true to accept, otherwise reject. */
  validate: (plan: RawPlan) => Promise<ValidationResult>;
}

export interface PlanWithRetryResult {
  plan: RawPlan;
  attempts: 1 | 2;
}

export async function generatePlanWithRetry(
  input: PlanWithRetryInput
): Promise<PlanWithRetryResult> {
  const { validate, ...planInput } = input;

  // First attempt.
  const first = await generatePlan(planInput);
  const firstValidation = await validate(first);
  if (firstValidation.ok) return { plan: first, attempts: 1 };

  // Second attempt with the failure fed back to the model.
  const retryInput: GeneratePlanInput = {
    ...planInput,
    previousFailure: { sql: first.sql, reason: firstValidation.reason },
  };
  const second = await generatePlan(retryInput);
  const secondValidation = await validate(second);
  if (secondValidation.ok) return { plan: second, attempts: 2 };

  throw new BaklavaException(
    makeError({
      code: "E_AI_PLAN_VALIDATION_FAILED",
      what: "The AI's query plan was rejected by the safety validator twice.",
      why: `First attempt: ${firstValidation.reason}. Second attempt: ${secondValidation.reason}.`,
      fix: "Try rephrasing your question. If you know SQL, click 'Edit SQL' to write the query yourself.",
      raw: {
        firstSql: first.sql,
        firstReason: firstValidation.reason,
        secondSql: second.sql,
        secondReason: secondValidation.reason,
      },
    })
  );
}
