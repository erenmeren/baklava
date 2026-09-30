import { SESSION_COOKIE, sessionIdFromToken } from "./session";
import { getSession, type SessionRecord } from "./sessions";

/** Pull a single cookie value out of a `Cookie` header (`a=b; c=d`). */
function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * The live session record behind the request's cookie, or null. The session
 * endpoints scope everything to `userId` from here — a session id on its own
 * says nothing about who may list or revoke it.
 */
export function callerSession(req: { headers: Headers }): SessionRecord | null {
  const id = sessionIdFromToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  return id ? getSession(id) : null;
}
