export interface BaklavaError {
  code: BaklavaErrorCode;
  what: string;
  why: string;
  fix: string;
  docs: string;
  raw?: unknown;
}

export const ERROR_CODES = [
  "E_AI_INVALID_PLAN",
  "E_AI_PLAN_VALIDATION_FAILED",
  "E_AI_KEY_MISSING",
  "E_AI_KEY_INVALID",
  "E_AI_RATE_LIMIT",
  "E_AI_QUOTA_EXCEEDED",
  "E_AI_TIMEOUT",
  "E_SOURCE_AUTH_FAILED",
  "E_SOURCE_CONNECTION_FAILED",
  "E_SOURCE_FETCH_FAILED",
  "E_SOURCE_SCHEMA_DRIFT",
  "E_DUCKDB_EXECUTE_FAILED",
  "E_DUCKDB_OOM",
  "E_LIMIT_TRUNCATED",
  "E_CONFIG_CORRUPT",
  "E_CONFIG_PERMISSIONS",
  "E_CONFIG_VERSION_UNSUPPORTED",
  "E_CONNECTION_NOT_FOUND",
  "E_CONNECTION_DUPLICATE_NAME",
  "E_CSRF_BAD_ORIGIN",
  "E_CSRF_BAD_HOST",
  "E_CSRF_MISSING_TOKEN",
  "E_PORT_IN_USE",
  "E_INSTANCE_ALREADY_RUNNING",
  "E_INTERNAL",
] as const;

export type BaklavaErrorCode = (typeof ERROR_CODES)[number];

const DOCS_BASE = "https://baklava.dev/docs/errors";

export function docsUrl(code: BaklavaErrorCode): string {
  return `${DOCS_BASE}/${code}`;
}

interface ErrorInput {
  code: BaklavaErrorCode;
  what: string;
  why: string;
  fix: string;
  raw?: unknown;
}

export function makeError(input: ErrorInput): BaklavaError {
  return {
    code: input.code,
    what: input.what,
    why: input.why,
    fix: input.fix,
    docs: docsUrl(input.code),
    ...(input.raw !== undefined ? { raw: input.raw } : {}),
  };
}

export class BaklavaException extends Error {
  readonly error: BaklavaError;
  constructor(error: BaklavaError) {
    super(`${error.code}: ${error.what} (why: ${error.why})`);
    this.name = "BaklavaException";
    this.error = error;
  }
}

export function isBaklavaError(value: unknown): value is BaklavaError {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === "string" &&
    ERROR_CODES.includes(v.code as BaklavaErrorCode) &&
    typeof v.what === "string" &&
    typeof v.why === "string" &&
    typeof v.fix === "string" &&
    typeof v.docs === "string"
  );
}
