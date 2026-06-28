import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { isAuthEnabled } from "@/lib/auth/store";
import { needsSetup } from "@/lib/auth/users";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getConnection } from "@/lib/connections/store";
import { effectiveAccess } from "@/lib/connections/access";
import { TECH_META } from "@/techs/meta-registry";

// Tech ids drive the connection-scoped path matcher below. Derived from the
// client-safe meta registry (no driver imports) so importing it into the proxy
// won't pull native deps into the bundle.
const TECH_IDS = new Set(Object.keys(TECH_META));

/**
 * Resolve the connection id for connection-scoped paths, or null otherwise.
 * Used by the proxy to gate direct-by-id access (a member could otherwise hit
 * a connection they can't see by guessing its URL).
 */
export function connectionIdFromPath(
  pathname: string,
  techIds: Set<string>
): string | null {
  let m = pathname.match(/^\/api\/connections\/([^/]+)(?:\/.*)?$/);
  if (m) return m[1];
  m = pathname.match(/^\/api\/ai\/connections\/([^/]+)(?:\/.*)?$/);
  if (m) return m[1];
  // Connection-scoped routes whose first path segment is NOT a tech id (so the
  // generic `/api/<tech>/<id>` branch below won't catch them). Keep this list in
  // sync with any new such route — see AGENTS.md.
  m = pathname.match(/^\/api\/dashboard\/([^/]+)(?:\/.*)?$/);
  if (m) return m[1];
  m = pathname.match(/^\/api\/([^/]+)\/([^/]+)(?:\/.*)?$/);
  if (m && techIds.has(m[1])) return m[2];
  m = pathname.match(/^\/([^/]+)\/([^/]+)(?:\/.*)?$/);
  if (m && techIds.has(m[1])) return m[2];
  return null;
}

const WRITE_METHODS = new Set(["PUT", "PATCH", "DELETE"]);

// Next 16 renamed `middleware` → `proxy`. It defaults to the Node.js runtime,
// so it can verify the HMAC-signed session cookie against the on-disk secret
// (node:crypto + node:fs) — a real gate, not just a cookie-presence check.

// Reachable without a valid session.
const PUBLIC_PAGES = ["/login"];
const PUBLIC_APIS = ["/api/auth/login", "/api/auth/logout"];
const SETUP_API = "/api/auth/setup";

export function proxy(req: NextRequest): NextResponse {
  // Gate turned off in Settings → let everything through.
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // No password configured yet → confine everything to the setup flow (the
  // /login page renders the create-password form; the setup API is allowed).
  if (needsSetup()) {
    if (pathname === "/login" || pathname === SETUP_API) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Setup required" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const authed = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  // Already signed in → keep them out of /login.
  if (authed && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const isPublic =
    PUBLIC_PAGES.some((p) => pathname === p) || PUBLIC_APIS.includes(pathname);

  if (!authed) {
    if (isPublic) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Connection-access gate (defense in depth). Per-user list filtering hides
  // connections a member can't access, but a member could still hit one
  // directly by id — so re-check access here for every connection-scoped path.
  const isApi = pathname.startsWith("/api/");
  const connId = connectionIdFromPath(pathname, TECH_IDS);
  if (connId) {
    const conn = getConnection(connId);
    // Unknown connection → let the route 404 normally (don't leak existence via
    // a different status from the access gate).
    if (conn) {
      const user = getCurrentUser(req);
      if (!user) {
        // Shouldn't happen post-`authed`, but fail closed.
        if (isApi) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        return NextResponse.redirect(new URL("/login", req.url));
      }
      const access = effectiveAccess({
        user: { id: user.id, role: user.role },
        conn: { id: connId, ownerId: conn.ownerId },
      });
      const forbidden = isApi
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : NextResponse.redirect(new URL("/", req.url));
      if (access === "none") return forbidden;
      // Write floor: mutating the connection itself (PUT/PATCH/DELETE on the
      // exact /api/connections/<id> resource) requires write/owner/admin.
      const isConnResource = /^\/api\/connections\/[^/]+$/.test(pathname);
      if (
        isConnResource &&
        WRITE_METHODS.has(req.method) &&
        access !== "write"
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets (incl. the public
  // /icons and /fonts dirs). RSC/page/API requests are all gated by the fn.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons|fonts|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|css|js|map)$).*)",
  ],
};
