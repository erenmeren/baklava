import { NextRequest, NextResponse } from "next/server";
import { needsSetup, createUser } from "@/lib/auth/users";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  isHttps,
} from "@/lib/auth/session";

export const runtime = "nodejs";

// First-run admin creation. Public (the user has no session yet) but usable
// ONLY while the console has no users — once any user exists this 409s, so it
// can't be abused to mint a second admin. Any non-empty password is fine; there
// are no length or composition rules. The username must match createUser's regex.
export async function POST(req: NextRequest) {
  if (!needsSetup()) {
    return NextResponse.json(
      { error: "Setup has already been completed" },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    username?: unknown;
    newPassword?: unknown;
  };
  const username = typeof body.username === "string" ? body.username : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  if (!username) {
    return NextResponse.json({ error: "Enter a username" }, { status: 400 });
  }
  if (!newPassword) {
    return NextResponse.json({ error: "Enter a password" }, { status: 400 });
  }

  let user;
  try {
    user = createUser({ username, password: newPassword, role: "admin" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create user" },
      { status: 400 },
    );
  }

  // Issue a session so the setup flow lands authenticated.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(user.id, req.headers.get("user-agent") ?? ""),
    sessionCookieOptions(isHttps(req)),
  );
  return res;
}
