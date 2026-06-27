import { NextRequest, NextResponse } from "next/server";
import { setPassword, verifyPassword } from "@/lib/auth/store";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  isHttps,
} from "@/lib/auth/session";
import { revokeAllExcept } from "@/lib/auth/sessions";

export const runtime = "nodejs";

// Voluntary password rotation from Settings → Security. Reaching this route
// already requires a valid session (enforced by proxy.ts), and we re-prove the
// current password so a hijacked open tab can't silently rotate it. Any
// non-empty new password is accepted — no length or composition rules.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    newPassword?: unknown;
    currentPassword?: unknown;
  };
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";

  if (!verifyPassword(currentPassword)) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  if (!newPassword) {
    return NextResponse.json(
      { error: "Enter a new password" },
      { status: 400 },
    );
  }

  setPassword(newPassword);

  // A password change invalidates every existing session (all devices).
  revokeAllExcept(null);

  // Re-issue the session so the change flow lands authenticated.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(req.headers.get("user-agent") ?? ""),
    sessionCookieOptions(isHttps(req)),
  );
  return res;
}
