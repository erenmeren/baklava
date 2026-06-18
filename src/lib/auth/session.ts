import { createHmac, timingSafeEqual } from "node:crypto";
import { getAuthSecret } from "./store";

// Stateless signed session token: `<payloadB64url>.<hmacB64url>`. The payload
// carries only an expiry — there are no users, just "is this an authenticated
// session". Signed with the per-install secret from the auth store, so tokens
// can't be forged without reading ~/.baklava/auth.json (mode 0600).

export const SESSION_COOKIE = "baklava_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload {
  exp: number; // ms epoch
}

function sign(payloadB64: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(payloadB64)
    .digest("base64url");
}

export function createSessionToken(): string {
  const payload: SessionPayload = { exp: Date.now() + SESSION_MAX_AGE_S * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as SessionPayload;
    return typeof payload.exp === "number" && Date.now() < payload.exp;
  } catch {
    return false;
  }
}

/** Cookie options. `secure` is set only over HTTPS so the cookie still works on
 *  plain-HTTP homelab deployments. */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: SESSION_MAX_AGE_S,
  };
}

/** Best-effort detection of an HTTPS request behind a proxy or direct. */
export function isHttps(req: {
  headers: { get(name: string): string | null };
  url: string;
}): boolean {
  const fwd = req.headers.get("x-forwarded-proto");
  if (fwd) return fwd.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}
