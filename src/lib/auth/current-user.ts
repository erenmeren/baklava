import { SESSION_COOKIE, userIdFromToken } from "./session";
import { getUserById, type UserRecord } from "./users";
import { isAuthEnabled } from "./store";

// When the password gate is OFF, Baklava is a single-user, full-trust console:
// the proxy returns early without establishing a session, so there's no cookie
// to resolve. To keep every getCurrentUser/requireUser/requireAdmin caller
// working exactly like the pre-RBAC single-user mode, we synthesize a stable
// admin. `effectiveAccess` already returns "write" for role "admin", so this
// also makes connection access unrestricted while the gate is off.
const LOCAL_ADMIN: UserRecord = {
  id: "__local_admin__",
  username: "local",
  role: "admin",
  disabled: false,
  createdAt: 0,
  updatedAt: 0,
  passwordHash: "",
  salt: "",
};

// Resolve the authenticated user from a request's session cookie. The cookie
// carries `<sessionId>.<hmac>`; userIdFromToken HMAC-verifies it and returns the
// userId from the live server-side session record. We then load the user and
// reject disabled accounts so a disabled user can't keep an active session.

/** Thrown by requireUser / requireAdmin. Carries the HTTP status to return. */
export class AuthError extends Error {
  status: 401 | 403;
  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

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

/** The current user, or null if the request is unauthenticated/invalid. */
export function getCurrentUser(req: { headers: Headers }): UserRecord | null {
  // Gate off = single-user full trust. Act as a synthetic admin so data routes,
  // the AI gate, and the users/access APIs all behave like pre-RBAC mode.
  if (!isAuthEnabled()) return LOCAL_ADMIN;
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const id = userIdFromToken(token);
  if (!id) return null;
  const user = getUserById(id);
  if (!user || user.disabled) return null;
  return user;
}

/** The current user, or throw AuthError(401). */
export function requireUser(req: { headers: Headers }): UserRecord {
  const user = getCurrentUser(req);
  if (!user) throw new AuthError(401, "Not authenticated");
  return user;
}

/** The current user if an admin, else throw AuthError(403) (401 if no user). */
export function requireAdmin(req: { headers: Headers }): UserRecord {
  const user = requireUser(req);
  if (user.role !== "admin") throw new AuthError(403, "Admin required");
  return user;
}

/** Map an AuthError to a JSON Response; return null for anything else so the
 *  caller can fall through to its generic error handling. */
export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
