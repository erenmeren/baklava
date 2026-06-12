import type { Auth, LoadTestConfig } from "./schema";
import type { SavedLoadTestConfig } from "./store-schema";

/**
 * Translate a UI-facing saved config (literal secret values) into the engine's
 * LoadTestConfig (auth references env-var NAMES) plus the env map of resolved
 * values. This keeps the engine unchanged and preserves its property that
 * secrets reach k6 only as container env, never embedded in the script text.
 */
export function toEngineConfig(
  saved: SavedLoadTestConfig,
  name: string,
): { config: LoadTestConfig; env: Record<string, string> } {
  const env: Record<string, string> = {};
  let auth: Auth;

  switch (saved.auth.type) {
    case "none":
      auth = { type: "none" };
      break;
    case "bearer":
      env.LT_BEARER = saved.auth.token;
      auth = { type: "bearer", tokenEnv: "LT_BEARER" };
      break;
    case "basic":
      env.LT_BASIC_USER = saved.auth.username;
      env.LT_BASIC_PASS = saved.auth.password;
      auth = { type: "basic", usernameEnv: "LT_BASIC_USER", passwordEnv: "LT_BASIC_PASS" };
      break;
    case "apiKey":
      env.LT_APIKEY = saved.auth.value;
      auth = { type: "apiKey", header: saved.auth.header, valueEnv: "LT_APIKEY" };
      break;
    case "customHeaders": {
      const headersEnv: Record<string, string> = {};
      Object.entries(saved.auth.headers).forEach(([header, value], i) => {
        const envName = `LT_CUSTOM_${i}`;
        env[envName] = value;
        headersEnv[header] = envName;
      });
      auth = { type: "customHeaders", headersEnv };
      break;
    }
  }

  const config: LoadTestConfig = {
    name,
    target: saved.target,
    requests: saved.requests,
    auth,
    profile: saved.profile,
    thresholds: saved.thresholds,
  };
  return { config, env };
}
