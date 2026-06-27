import { createHmac, timingSafeEqual } from "node:crypto";
import { getAuthSecret } from "./store";
import { createSession, verifySession, revokeSession } from "./sessions";

// The cookie carries `<sessionId>.<hmac(sessionId)>`. The HMAC (per-install auth
// secret) is a cheap pre-filter to reject forged/garbage ids before a store
// lookup; the server-side record is the source of truth, so logout and the
// device list can actually revoke a session.

export const SESSION_COOKIE = "baklava_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // cookie max-age; idle slide enforced server-side

function sign(id: string): string {
  return createHmac("sha256", getAuthSecret()).update(id).digest("base64url");
}

export function sessionIdFromToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(id));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export function createSessionToken(userAgent = ""): string {
  const rec = createSession(userAgent);
  return `${rec.id}.${sign(rec.id)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  const id = sessionIdFromToken(token);
  if (!id) return false;
  return verifySession(id);
}

export function revokeSessionToken(token: string | undefined | null): void {
  const id = sessionIdFromToken(token);
  if (id) revokeSession(id);
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
