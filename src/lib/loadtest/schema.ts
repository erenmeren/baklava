import { z } from "zod";

export const httpMethodSchema = z.enum([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
]);

export const requestCheckSchema = z.object({
  status: z.number().int().optional(),
  bodyContains: z.string().optional(),
});

export const requestStepSchema = z.object({
  name: z.string().min(1),
  method: httpMethodSchema.default("GET"),
  path: z.string().default("/"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  checks: requestCheckSchema.optional(),
  thinkTime: z.number().nonnegative().optional(),
});

export const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), tokenEnv: z.string().min(1) }),
  z.object({
    type: z.literal("basic"),
    usernameEnv: z.string().min(1),
    passwordEnv: z.string().min(1),
  }),
  z.object({
    type: z.literal("apiKey"),
    header: z.string().min(1),
    valueEnv: z.string().min(1),
  }),
  z.object({
    type: z.literal("customHeaders"),
    headersEnv: z.record(z.string(), z.string()),
  }),
]);

const stageSchema = z.object({
  target: z.number().nonnegative(),
  duration: z.string().min(1),
});

export const profileSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("constant"),
    vus: z.number().int().positive(),
    duration: z.string().min(1),
  }),
  z.object({
    type: z.literal("ramping"),
    startVUs: z.number().int().nonnegative().default(0),
    stages: z.array(stageSchema).min(1),
  }),
  z.object({
    type: z.literal("constantRate"),
    rate: z.number().positive(),
    duration: z.string().min(1),
    preAllocatedVUs: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("rampingRate"),
    startRate: z.number().nonnegative().default(0),
    preAllocatedVUs: z.number().int().positive(),
    stages: z.array(stageSchema).min(1),
  }),
  z.object({
    type: z.literal("baseline"),
    rate: z.number().positive().default(50),
    duration: z.string().default("1m"),
    preAllocatedVUs: z.number().int().positive().default(50),
  }),
  z.object({
    type: z.literal("breakpoint"),
    maxRate: z.number().positive().default(500),
    duration: z.string().default("2m"),
    preAllocatedVUs: z.number().int().positive().default(200),
  }),
]);

export const thresholdsSchema = z
  .object({
    p95: z.number().positive().optional(),
    p99: z.number().positive().optional(),
    errorRate: z.number().min(0).max(1).optional(),
    minRps: z.number().positive().optional(),
  })
  .optional();

export const loadTestConfigSchema = z.object({
  name: z.string().default("loadtest"),
  target: z.object({
    baseUrl: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  requests: z.array(requestStepSchema).min(1),
  auth: authSchema.default({ type: "none" }),
  profile: profileSchema,
  thresholds: thresholdsSchema,
});

export type LoadTestConfig = z.infer<typeof loadTestConfigSchema>;
export type RequestStep = z.infer<typeof requestStepSchema>;
export type LoadProfile = z.infer<typeof profileSchema>;
export type Auth = z.infer<typeof authSchema>;
export type Thresholds = z.infer<typeof thresholdsSchema>;

export function requiredEnvVars(auth: Auth): string[] {
  switch (auth.type) {
    case "bearer":
      return [auth.tokenEnv];
    case "basic":
      return [auth.usernameEnv, auth.passwordEnv];
    case "apiKey":
      return [auth.valueEnv];
    case "customHeaders":
      return Object.values(auth.headersEnv);
    case "none":
      return [];
  }
}
