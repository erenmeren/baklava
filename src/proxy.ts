import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { mustChangePassword } from "@/lib/auth/store";

// Next 16 renamed `middleware` → `proxy`. It defaults to the Node.js runtime,
// so it can verify the HMAC-signed session cookie against the on-disk secret
// (node:crypto + node:fs) — a real gate, not just a cookie-presence check.

// Reachable without a valid session.
const PUBLIC_PAGES = ["/login"];
const PUBLIC_APIS = ["/api/auth/login", "/api/auth/logout"];

function isAuthApi(pathname: string): boolean {
  return pathname.startsWith("/api/auth/");
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const authed = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const mustChange = authed && mustChangePassword();

  // Already signed in and not mid-bootstrap → keep them out of /login.
  if (authed && !mustChange && pathname === "/login") {
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

  // Authenticated but still on the bootstrap password: confine to the change
  // flow (the /login page renders the change form; change-password API allowed).
  if (mustChange && pathname !== "/login" && !isAuthApi(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Password change required" },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets (incl. the public
  // /icons and /fonts dirs). RSC/page/API requests are all gated by the fn.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|fonts|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|css|js|map)$).*)",
  ],
};
